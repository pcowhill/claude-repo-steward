import type { ActionProposal } from '../core/proposals';
import type { StewardConfig } from '../core/config/schema';
import { checkDocPath } from '../core/paths';
import { diffTrees, patchStats } from '../core/diff';
import type { SimState, TargetRef } from './types';
import {
  addInlineComment,
  addLabel,
  assignUser,
  closeIssue,
  commitFiles,
  createBranch,
  openPullRequest,
  postComment,
  pushTimeline,
  removeLabel,
  reopenIssue,
  treeToFiles,
} from './mutations';

/**
 * The simulator executor — the ONLY code allowed to mutate the simulated
 * repository on Repo Steward's behalf.
 *
 * Defense in depth: even when the policy engine says "executed", this layer
 * re-checks the invariants that must never break. Buttons are not the
 * boundary; this code is. `modify_source_code`, pushes to protected
 * branches, merges, workflow-file edits, and out-of-bounds documentation
 * patches are refused here no matter what any config or analyzer says.
 */

export const STEWARD_LOGIN = 'repo-steward[bot]';

export interface ExecutionOutcome {
  ok: boolean;
  summary: string;
  error?: string;
  refs: { issueNumber?: number; prNumber?: number; branch?: string; commitSha?: string; path?: string };
}

const refuse = (error: string): ExecutionOutcome => ({ ok: false, summary: error, error, refs: {} });

function proposalTargetRef(proposal: ActionProposal): TargetRef | null {
  if (proposal.target.kind === 'issue') return { kind: 'issue', number: proposal.target.number };
  if (proposal.target.kind === 'pull_request')
    return { kind: 'pull_request', number: proposal.target.number };
  return null;
}

/** Validate a docs patch against non-negotiable executor constraints. */
function validateDocsPatch(
  state: SimState,
  config: StewardConfig,
  files: Array<{ path: string; newContent: string }>,
): string | null {
  for (const file of files) {
    if (file.path.startsWith('.github/workflows/')) {
      return `Executor refused: "${file.path}" is a workflow file (safety.modifyWorkflowFiles).`;
    }
    const check = checkDocPath(file.path, config.documentation.editablePaths, config.documentation.forbiddenPaths);
    if (!check.allowed) {
      return `Executor refused: "${file.path}" ${check.rule}.`;
    }
  }
  const mainFiles = treeToFiles(state, state.branches[state.repo.defaultBranch].tree);
  const changed: Record<string, string> = {};
  const before: Record<string, string> = {};
  for (const f of files) {
    before[f.path] = mainFiles[f.path] ?? '';
    changed[f.path] = f.newContent;
  }
  const stats = patchStats(diffTrees(before, changed));
  if (stats.filesChanged > config.documentation.maxFilesChanged) {
    return `Executor refused: patch changes ${stats.filesChanged} files (limit ${config.documentation.maxFilesChanged}).`;
  }
  if (stats.linesChanged > config.documentation.maxLinesChanged) {
    return `Executor refused: patch changes ${stats.linesChanged} lines (limit ${config.documentation.maxLinesChanged}).`;
  }
  return null;
}

/**
 * Execute an approved/automatic proposal against the draft state.
 * Never throws for policy reasons — refusals come back as `ok: false`.
 */
export function executeProposal(
  state: SimState,
  proposal: ActionProposal,
  config: StewardConfig,
  ts: string,
): ExecutionOutcome {
  // ── Non-negotiable refusals, regardless of configuration ────────────────
  switch (proposal.actionType) {
    case 'modify_source_code':
      return refuse('Executor refused: Repo Steward may never modify source code in this version.');
    case 'push_to_protected_branch':
      return refuse('Executor refused: Repo Steward may never push to a protected branch.');
    case 'merge_pull_request':
    case 'merge_docs_pull_request':
      return refuse('Executor refused: Repo Steward may never merge pull requests in this version.');
    default:
      break;
  }
  // Config-dependent hard stops re-checked at the execution boundary.
  if (proposal.actionType === 'close_issue' && (!config.safety.closeIssues || config.issueTriage.closeIssues === 'disabled')) {
    return refuse('Executor refused: issue closing is disabled by safety.closeIssues / issueTriage.closeIssues.');
  }
  if (proposal.actionType === 'assign_user' && (!config.safety.assignUsers || config.issueTriage.assignUsers === 'disabled')) {
    return refuse('Executor refused: user assignment is disabled by safety.assignUsers / issueTriage.assignUsers.');
  }

  try {
    switch (proposal.actionType) {
      case 'add_label': {
        const ref = proposalTargetRef(proposal);
        if (!ref) return refuse('add_label requires an issue or pull request target.');
        const summary = addLabel(state, ref, proposal.payload.label, STEWARD_LOGIN, ts);
        return { ok: true, summary, refs: refFor(ref) };
      }
      case 'remove_label': {
        const ref = proposalTargetRef(proposal);
        if (!ref) return refuse('remove_label requires an issue or pull request target.');
        const summary = removeLabel(state, ref, proposal.payload.label, STEWARD_LOGIN, ts);
        return { ok: true, summary, refs: refFor(ref) };
      }
      case 'post_issue_comment':
      case 'post_readiness_assessment':
      case 'ask_clarifying_questions':
      case 'post_implementation_plan': {
        const ref = proposalTargetRef(proposal);
        if (!ref || ref.kind !== 'issue') return refuse(`${proposal.actionType} requires an issue target.`);
        const kind =
          proposal.actionType === 'post_readiness_assessment'
            ? 'readiness_assessment'
            : proposal.actionType === 'ask_clarifying_questions'
              ? 'clarifying_questions'
              : proposal.actionType === 'post_implementation_plan'
                ? 'implementation_plan'
                : 'generic';
        const summary = postComment(state, ref, proposal.payload.body, STEWARD_LOGIN, ts, kind);
        return { ok: true, summary, refs: refFor(ref) };
      }
      case 'mark_ai_candidate': {
        const ref = proposalTargetRef(proposal);
        if (!ref) return refuse('mark_ai_candidate requires an issue or pull request target.');
        const summary = addLabel(state, ref, 'ai-candidate', STEWARD_LOGIN, ts);
        return { ok: true, summary, refs: refFor(ref) };
      }
      case 'assign_user': {
        const ref = proposalTargetRef(proposal);
        if (!ref) return refuse('assign_user requires an issue target.');
        const summary = assignUser(state, ref, proposal.payload.username, STEWARD_LOGIN, ts);
        return { ok: true, summary, refs: refFor(ref) };
      }
      case 'close_issue': {
        if (proposal.target.kind !== 'issue') return refuse('close_issue requires an issue target.');
        const summary = closeIssue(state, proposal.target.number, STEWARD_LOGIN, ts, proposal.payload.reason);
        return { ok: true, summary, refs: { issueNumber: proposal.target.number } };
      }
      case 'reopen_issue': {
        if (proposal.target.kind !== 'issue') return refuse('reopen_issue requires an issue target.');
        const summary = reopenIssue(state, proposal.target.number, STEWARD_LOGIN, ts, proposal.payload.reason);
        return { ok: true, summary, refs: { issueNumber: proposal.target.number } };
      }
      case 'post_pr_summary':
      case 'post_pr_review_comment':
      case 'identify_test_gap':
      case 'assess_linked_issue_coverage':
      case 'assess_docs_impact': {
        const ref = proposalTargetRef(proposal);
        if (!ref || ref.kind !== 'pull_request')
          return refuse(`${proposal.actionType} requires a pull request target.`);
        const kind =
          proposal.actionType === 'post_pr_summary'
            ? 'pr_summary'
            : proposal.actionType === 'identify_test_gap'
              ? 'test_gap'
              : proposal.actionType === 'assess_linked_issue_coverage'
                ? 'issue_coverage'
                : proposal.actionType === 'assess_docs_impact'
                  ? 'docs_impact'
                  : 'generic';
        const summary = postComment(state, ref, proposal.payload.body, STEWARD_LOGIN, ts, kind);
        return { ok: true, summary, refs: refFor(ref) };
      }
      case 'post_inline_comment': {
        if (proposal.target.kind !== 'pull_request')
          return refuse('post_inline_comment requires a pull request target.');
        const summary = addInlineComment(
          state,
          proposal.target.number,
          proposal.payload.path,
          proposal.payload.line,
          proposal.payload.body,
          STEWARD_LOGIN,
          ts,
        );
        return {
          ok: true,
          summary,
          refs: { prNumber: proposal.target.number, path: proposal.payload.path },
        };
      }
      case 'request_changes':
      case 'approve_pull_request': {
        if (proposal.target.kind !== 'pull_request')
          return refuse(`${proposal.actionType} requires a pull request target.`);
        const pr = state.pulls[proposal.target.number];
        if (!pr) return refuse(`Unknown pull request #${proposal.target.number}`);
        const reviewState = proposal.actionType === 'approve_pull_request' ? 'approved' : 'changes_requested';
        pr.reviews.push({
          id: `rev-${state.counters.id++}`,
          author: STEWARD_LOGIN,
          state: reviewState,
          body: proposal.payload.body,
          timestamp: ts,
        });
        pushTimeline(state, { kind: 'pull_request', number: pr.number }, 'review', STEWARD_LOGIN, ts, {
          reviewState,
          body: proposal.payload.body,
        });
        return { ok: true, summary: `Submitted ${reviewState} review on #${pr.number}`, refs: { prNumber: pr.number } };
      }
      case 'propose_docs_patch': {
        const error = validateDocsPatch(state, config, proposal.payload.patch.files);
        if (error) return refuse(error);
        // Preparing a patch mutates nothing; the validated patch is carried
        // by the proposal and previewed in the inbox. This is the recorded
        // "the patch exists and is inside policy bounds" step.
        return {
          ok: true,
          summary: `Prepared docs patch covering ${proposal.payload.patch.files.length} file(s): ${proposal.payload.patch.files.map((f) => f.path).join(', ')}`,
          refs: { path: proposal.payload.patch.files[0]?.path },
        };
      }
      case 'open_draft_docs_pull_request': {
        const { branchName, patch, title, body, linkedPrNumber } = proposal.payload;
        const error = validateDocsPatch(state, config, patch.files);
        if (error) return refuse(error);
        if (state.branches[branchName]) {
          return refuse(`Executor refused: branch "${branchName}" already exists.`);
        }
        createBranch(state, branchName, state.repo.defaultBranch, STEWARD_LOGIN, ts);
        const { sha } = commitFiles(
          state,
          branchName,
          patch.files.map((f) => ({ path: f.path, content: f.newContent })),
          `docs: ${title}\n\n${patch.rationale}`,
          STEWARD_LOGIN,
          ts,
        );
        const { pr } = openPullRequest(state, {
          title,
          body,
          author: STEWARD_LOGIN,
          baseBranch: state.repo.defaultBranch,
          headBranch: branchName,
          draft: true,
          labels: ['documentation'],
          linkedIssueNumbers: linkedPrNumber ? [linkedPrNumber] : [],
          createdBySteward: true,
          ts,
        });
        return {
          ok: true,
          summary: `Created branch "${branchName}", commit ${sha}, and draft PR #${pr.number}`,
          refs: { branch: branchName, commitSha: sha, prNumber: pr.number },
        };
      }
      case 'update_docs_branch': {
        const { branchName, patch } = proposal.payload;
        const error = validateDocsPatch(state, config, patch.files);
        if (error) return refuse(error);
        const branch = state.branches[branchName];
        if (!branch) return refuse(`Executor refused: branch "${branchName}" does not exist.`);
        if (branch.protected) return refuse(`Executor refused: branch "${branchName}" is protected.`);
        if (branch.createdBy !== STEWARD_LOGIN) {
          return refuse(`Executor refused: "${branchName}" was not created by Repo Steward.`);
        }
        const { sha } = commitFiles(
          state,
          branchName,
          patch.files.map((f) => ({ path: f.path, content: f.newContent })),
          `docs: update steward docs branch\n\n${patch.rationale}`,
          STEWARD_LOGIN,
          ts,
        );
        return { ok: true, summary: `Committed ${sha} to "${branchName}"`, refs: { branch: branchName, commitSha: sha } };
      }
      default:
        // Exhaustive over the schema; anything else never reaches here
        // because schema validation rejects unknown action types.
        return refuse(`Executor refused: unsupported action "${(proposal as ActionProposal).actionType}".`);
    }
  } catch (err) {
    return {
      ok: false,
      summary: err instanceof Error ? err.message : 'Execution failed',
      error: err instanceof Error ? err.message : 'Execution failed',
      refs: {},
    };
  }
}

function refFor(ref: TargetRef) {
  return ref.kind === 'issue' ? { issueNumber: ref.number } : { prNumber: ref.number };
}
