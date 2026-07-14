import type {
  SimPull,
  SimState,
  SimTimelineEvent,
  TargetRef,
  Tree,
} from './types';
import { timelineKey } from './types';
import { putBlob } from './hash';

/**
 * Imperative mutation helpers. They operate on a *draft* state (the store
 * clones before every update) and are the only code that changes repository
 * entities. Each returns a short human-readable summary for audit records.
 */

export function nextId(state: SimState, prefix: string): string {
  state.counters.id += 1;
  return `${prefix}-${state.counters.id}`;
}

export function nextSha(state: SimState): string {
  state.counters.sha += 1;
  // Deterministic fake sha, e.g. "ad00c1e5f3a".
  const n = (0x9ad00c + state.counters.sha * 0x1f7) >>> 0;
  return n.toString(16).padStart(6, '0') + (0xe5f3a + state.counters.sha * 0x35).toString(16).slice(-5);
}

export function pushTimeline(
  state: SimState,
  ref: TargetRef,
  type: SimTimelineEvent['type'],
  actor: string,
  timestamp: string,
  data: SimTimelineEvent['data'] = {},
): SimTimelineEvent {
  const key = timelineKey(ref);
  const event: SimTimelineEvent = { id: nextId(state, 'tl'), type, actor, timestamp, data };
  if (!state.timelines[key]) state.timelines[key] = [];
  state.timelines[key].push(event);
  return event;
}

function getTarget(state: SimState, ref: TargetRef) {
  return ref.kind === 'issue' ? state.issues[ref.number] : state.pulls[ref.number];
}

export function addLabel(state: SimState, ref: TargetRef, label: string, actor: string, ts: string): string {
  const target = getTarget(state, ref);
  if (!target) throw new Error(`Unknown ${ref.kind} #${ref.number}`);
  if (!(label in state.labels)) throw new Error(`Unknown label "${label}"`);
  if (target.labels.includes(label)) return `Label "${label}" already present on #${ref.number}`;
  target.labels.push(label);
  target.updatedAt = ts;
  pushTimeline(state, ref, 'labeled', actor, ts, { label });
  return `Added label "${label}" to #${ref.number}`;
}

export function removeLabel(state: SimState, ref: TargetRef, label: string, actor: string, ts: string): string {
  const target = getTarget(state, ref);
  if (!target) throw new Error(`Unknown ${ref.kind} #${ref.number}`);
  const idx = target.labels.indexOf(label);
  if (idx === -1) return `Label "${label}" was not present on #${ref.number}`;
  target.labels.splice(idx, 1);
  target.updatedAt = ts;
  pushTimeline(state, ref, 'unlabeled', actor, ts, { label });
  return `Removed label "${label}" from #${ref.number}`;
}

export function postComment(
  state: SimState,
  ref: TargetRef,
  body: string,
  actor: string,
  ts: string,
  stewardKind?: NonNullable<SimTimelineEvent['data']['stewardKind']>,
): string {
  const target = getTarget(state, ref);
  if (!target) throw new Error(`Unknown ${ref.kind} #${ref.number}`);
  target.updatedAt = ts;
  pushTimeline(state, ref, 'comment', actor, ts, { body, stewardKind });
  return `Posted comment on #${ref.number}`;
}

export function addInlineComment(
  state: SimState,
  prNumber: number,
  path: string,
  line: number,
  body: string,
  actor: string,
  ts: string,
): string {
  const pr = state.pulls[prNumber];
  if (!pr) throw new Error(`Unknown pull request #${prNumber}`);
  pr.inlineComments.push({ id: nextId(state, 'ic'), path, line, author: actor, body, timestamp: ts });
  pr.updatedAt = ts;
  return `Added inline comment on ${path}:${line} in #${prNumber}`;
}

export function assignUser(state: SimState, ref: TargetRef, username: string, actor: string, ts: string): string {
  const target = getTarget(state, ref);
  if (!target) throw new Error(`Unknown ${ref.kind} #${ref.number}`);
  if (ref.kind === 'pull_request') throw new Error('Assignment is only modeled for issues');
  const issue = state.issues[ref.number];
  if (!issue.assignees.includes(username)) issue.assignees.push(username);
  pushTimeline(state, ref, 'assigned', actor, ts, { assignee: username });
  return `Assigned ${username} to #${ref.number}`;
}

export function closeIssue(state: SimState, number: number, actor: string, ts: string, reason: string): string {
  const issue = state.issues[number];
  if (!issue) throw new Error(`Unknown issue #${number}`);
  issue.state = 'closed';
  issue.stateReason = 'completed';
  issue.updatedAt = ts;
  pushTimeline(state, { kind: 'issue', number }, 'closed', actor, ts, { body: reason });
  return `Closed issue #${number}`;
}

export function reopenIssue(state: SimState, number: number, actor: string, ts: string, reason: string): string {
  const issue = state.issues[number];
  if (!issue) throw new Error(`Unknown issue #${number}`);
  issue.state = 'open';
  issue.stateReason = null;
  issue.updatedAt = ts;
  pushTimeline(state, { kind: 'issue', number }, 'reopened', actor, ts, { body: reason });
  return `Reopened issue #${number}`;
}

export function createBranch(
  state: SimState,
  name: string,
  fromBranch: string,
  actor: string,
  ts: string,
): string {
  if (state.branches[name]) throw new Error(`Branch "${name}" already exists`);
  const source = state.branches[fromBranch];
  if (!source) throw new Error(`Unknown source branch "${fromBranch}"`);
  state.branches[name] = {
    name,
    tree: { ...source.tree },
    headSha: source.headSha,
    protected: false,
    createdBy: actor,
    createdAt: ts,
    ahead: 0,
    behind: 0,
    linkedPrNumber: null,
  };
  state.branchCommits[name] = [...(state.branchCommits[fromBranch] ?? [])];
  return `Created branch "${name}" from "${fromBranch}"`;
}

export function commitFiles(
  state: SimState,
  branchName: string,
  files: Array<{ path: string; content: string }>,
  message: string,
  author: string,
  ts: string,
): { sha: string; summary: string } {
  const branch = state.branches[branchName];
  if (!branch) throw new Error(`Unknown branch "${branchName}"`);
  if (branch.protected) throw new Error(`Branch "${branchName}" is protected`);
  const tree: Tree = { ...branch.tree };
  for (const file of files) {
    tree[file.path] = putBlob(state.blobs, file.content);
  }
  const sha = nextSha(state);
  state.commits[sha] = {
    sha,
    message,
    author,
    timestamp: ts,
    parents: [branch.headSha],
    changedPaths: files.map((f) => f.path),
  };
  branch.tree = tree;
  branch.headSha = sha;
  branch.ahead += 1;
  state.branchCommits[branchName] = [sha, ...(state.branchCommits[branchName] ?? [])];
  return { sha, summary: `Committed ${sha} ("${message.split('\n')[0]}") to ${branchName}` };
}

export function openPullRequest(
  state: SimState,
  input: {
    title: string;
    body: string;
    author: string;
    baseBranch: string;
    headBranch: string;
    draft: boolean;
    labels?: string[];
    linkedIssueNumbers?: number[];
    createdBySteward?: boolean;
    ts: string;
  },
): { pr: SimPull; summary: string } {
  const base = state.branches[input.baseBranch];
  const head = state.branches[input.headBranch];
  if (!base) throw new Error(`Unknown base branch "${input.baseBranch}"`);
  if (!head) throw new Error(`Unknown head branch "${input.headBranch}"`);
  const number = state.counters.number++;
  const pr: SimPull = {
    number,
    title: input.title,
    body: input.body,
    author: input.author,
    state: 'open',
    draft: input.draft,
    baseBranch: input.baseBranch,
    headBranch: input.headBranch,
    baseTree: { ...base.tree },
    headTree: { ...head.tree },
    commitShas: state.branchCommits[input.headBranch].filter(
      (sha) => !(state.branchCommits[input.baseBranch] ?? []).includes(sha),
    ),
    checks: [
      { name: 'docs-link-check', status: 'success', description: 'markdown links resolve', durationSec: 6 },
    ],
    reviews: [],
    inlineComments: [],
    labels: input.labels ?? [],
    createdAt: input.ts,
    updatedAt: input.ts,
    mergedAt: null,
    mergedBy: null,
    linkedIssueNumbers: input.linkedIssueNumbers ?? [],
    createdBySteward: input.createdBySteward ?? false,
  };
  state.pulls[number] = pr;
  head.linkedPrNumber = number;
  state.timelines[`pr-${number}`] = [];
  pushTimeline(state, { kind: 'pull_request', number }, 'pr_opened', input.author, input.ts, {
    prNumber: number,
  });
  for (const sha of [...pr.commitShas].reverse()) {
    const commit = state.commits[sha];
    if (commit) {
      pushTimeline(state, { kind: 'pull_request', number }, 'committed', commit.author, commit.timestamp, {
        sha,
        message: commit.message.split('\n')[0],
      });
    }
  }
  // Cross-reference on the linked PR/issue timelines.
  for (const linked of pr.linkedIssueNumbers) {
    if (state.issues[linked]) {
      pushTimeline(state, { kind: 'issue', number: linked }, 'cross_reference', input.author, input.ts, {
        prNumber: number,
      });
    } else if (state.pulls[linked]) {
      pushTimeline(state, { kind: 'pull_request', number: linked }, 'cross_reference', input.author, input.ts, {
        prNumber: number,
      });
    }
  }
  return { pr, summary: `Opened ${input.draft ? 'draft ' : ''}pull request #${number} (${input.headBranch} → ${input.baseBranch})` };
}

/** Resolve the trees to diff for a PR (frozen for merged, live for open). */
export function prTrees(state: SimState, pr: SimPull): { base: Tree; head: Tree } {
  if (pr.state === 'open' && state.branches[pr.headBranch]) {
    return { base: pr.baseTree, head: state.branches[pr.headBranch].tree };
  }
  return { base: pr.baseTree, head: pr.headTree };
}

export function treeToFiles(state: SimState, tree: Tree): Record<string, string> {
  const files: Record<string, string> = {};
  for (const [path, hash] of Object.entries(tree)) {
    files[path] = state.blobs[hash] ?? '';
  }
  return files;
}
