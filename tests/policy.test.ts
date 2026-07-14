import { describe, expect, it } from 'vitest';
import { evaluateProposal } from '../src/core/policy/engine';
import { DEFAULT_CONFIG } from '../src/core/config/defaults';
import type { StewardConfig } from '../src/core/config/schema';
import { proposal } from './helpers';

const ctx = () => ({ now: () => '2026-07-14T00:00:00Z', makeId: () => 'dec-1' });
const withConfig = (mutate: (c: StewardConfig) => void): StewardConfig => {
  const c: StewardConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  mutate(c);
  return c;
};

describe('policy engine — autonomy levels', () => {
  it('executes automatic actions above the automatic threshold', () => {
    const d = evaluateProposal(DEFAULT_CONFIG, proposal({ actionType: 'add_label', confidence: 0.91 }), ctx());
    expect(d.initialDisposition).toBe('executed');
    expect(d.configPath).toBe('issueTriage.addLabels');
    expect(d.explanation).toContain('issueTriage.addLabels is automatic');
    expect(d.explanation).toContain('0.91');
    expect(d.explanation).toContain('0.82');
  });

  it('sends propose-level actions to the inbox', () => {
    const d = evaluateProposal(DEFAULT_CONFIG, proposal({ actionType: 'remove_label', confidence: 0.72 }), ctx());
    expect(d.initialDisposition).toBe('awaiting_approval');
    expect(d.explanation).toContain('issueTriage.removeLabels is set to propose');
  });

  it('blocks disabled actions and names the rule', () => {
    const d = evaluateProposal(DEFAULT_CONFIG, proposal({ actionType: 'approve_pull_request', confidence: 0.99, target: { kind: 'pull_request', number: 47 } }), ctx());
    expect(d.initialDisposition).toBe('blocked');
    expect(d.explanation).toBe('Blocked because pullRequestReview.approvePullRequest is disabled.');
  });

  it('downgrades automatic actions below the automatic threshold', () => {
    const d = evaluateProposal(DEFAULT_CONFIG, proposal({ actionType: 'add_label', confidence: 0.76 }), ctx());
    expect(d.initialDisposition).toBe('downgraded_to_proposal');
    expect(d.explanation).toContain('Downgraded to proposal');
    expect(d.explanation).toContain('0.76 is below the 0.82');
  });

  it('blocks automatic actions below threshold when downgrading is off', () => {
    const config = withConfig((c) => {
      c.analysis.downgradeAutomaticBelowThreshold = false;
    });
    const d = evaluateProposal(config, proposal({ actionType: 'add_label', confidence: 0.76 }), ctx());
    expect(d.initialDisposition).toBe('blocked');
  });

  it('blocks anything below the minimum proposal confidence', () => {
    const d = evaluateProposal(DEFAULT_CONFIG, proposal({ actionType: 'remove_label', confidence: 0.4 }), ctx());
    expect(d.initialDisposition).toBe('blocked');
    expect(d.explanation).toContain('minimum proposal threshold');
  });
});

describe('policy engine — global safety overrides', () => {
  it('blocks close_issue via safety.closeIssues even if triage were automatic', () => {
    const config = withConfig((c) => {
      c.issueTriage.closeIssues = 'automatic';
    });
    const d = evaluateProposal(config, proposal({ actionType: 'close_issue', confidence: 1.0 }), ctx());
    expect(d.initialDisposition).toBe('blocked');
    expect(d.explanation).toContain('safety.closeIssues is false');
  });

  it('blocks assign_user via safety.assignUsers regardless of confidence 1.0', () => {
    const config = withConfig((c) => {
      c.issueTriage.assignUsers = 'automatic';
    });
    const d = evaluateProposal(config, proposal({ actionType: 'assign_user', confidence: 1.0 }), ctx());
    expect(d.initialDisposition).toBe('blocked');
    expect(d.safetyChecks.some((s) => s.rule.startsWith('safety.assignUsers') && !s.passed)).toBe(true);
  });

  it('blocks merges via safety.autoMerge', () => {
    const d = evaluateProposal(DEFAULT_CONFIG, proposal({ actionType: 'merge_pull_request', confidence: 1.0, target: { kind: 'pull_request', number: 47 } }), ctx());
    expect(d.initialDisposition).toBe('blocked');
    expect(d.explanation).toContain('safety.autoMerge is false');
  });

  it('blocks pushes to protected branches', () => {
    const d = evaluateProposal(DEFAULT_CONFIG, proposal({ actionType: 'push_to_protected_branch', confidence: 1.0, target: { kind: 'branch', name: 'main' } }), ctx());
    expect(d.initialDisposition).toBe('blocked');
    expect(d.explanation).toContain('safety.pushToProtectedBranches is false');
  });

  it('blocks workflow-file edits through any action type', () => {
    const p = proposal({
      actionType: 'propose_docs_patch',
      confidence: 1.0,
      target: { kind: 'file', path: '.github/workflows/ci.yml' },
      payload: {
        patch: { rationale: 'r', files: [{ path: '.github/workflows/ci.yml', newContent: 'x', summary: 's' }] },
      },
    });
    const d = evaluateProposal(DEFAULT_CONFIG, p, ctx());
    expect(d.initialDisposition).toBe('blocked');
    expect(d.explanation).toContain('safety.modifyWorkflowFiles');
  });
});

describe('policy engine — documentation constraints', () => {
  it('blocks patches touching forbidden paths regardless of confidence', () => {
    const p = proposal({
      actionType: 'propose_docs_patch',
      confidence: 1.0,
      payload: { patch: { rationale: 'r', files: [{ path: 'src/state/readinessStore.ts', newContent: 'x', summary: 's' }] } },
    });
    const d = evaluateProposal(DEFAULT_CONFIG, p, ctx());
    expect(d.initialDisposition).toBe('blocked');
    expect(d.explanation).toContain('forbidden path');
    expect(d.pathChecks.some((c) => !c.allowed)).toBe(true);
  });

  it('blocks patches outside the editable allowlist', () => {
    const p = proposal({
      actionType: 'propose_docs_patch',
      confidence: 1.0,
      payload: { patch: { rationale: 'r', files: [{ path: 'notes/todo.md', newContent: 'x', summary: 's' }] } },
    });
    const d = evaluateProposal(DEFAULT_CONFIG, p, ctx());
    expect(d.initialDisposition).toBe('blocked');
    expect(d.explanation).toContain('matches no editable path');
  });

  it('blocks patches over the max-files limit', () => {
    const files = ['docs/a.md', 'docs/b.md', 'docs/c.md', 'docs/d.md'].map((path) => ({ path, newContent: 'x', summary: 's' }));
    const p = proposal({ actionType: 'propose_docs_patch', confidence: 1.0, payload: { patch: { rationale: 'r', files } } });
    const d = evaluateProposal(DEFAULT_CONFIG, p, ctx(), );
    // File-count limits are checked from patch stats when provided…
    const withStats = evaluateProposal(DEFAULT_CONFIG, p, { ...ctx(), patchStats: { filesChanged: 4, linesChanged: 4, additions: 4, deletions: 0 } });
    expect(withStats.initialDisposition).toBe('blocked');
    expect(withStats.explanation).toContain('maxFilesChanged');
    // …and the proposal without stats still passes path checks only.
    expect(d.pathChecks.every((c) => c.allowed)).toBe(true);
  });

  it('blocks patches over the max-lines limit', () => {
    const p = proposal({ actionType: 'propose_docs_patch', confidence: 1.0 });
    const d = evaluateProposal(DEFAULT_CONFIG, p, {
      ...ctx(),
      patchStats: { filesChanged: 1, linesChanged: 500, additions: 500, deletions: 0 },
    });
    expect(d.initialDisposition).toBe('blocked');
    expect(d.explanation).toContain('maxLinesChanged');
  });
});

describe('policy engine — source code', () => {
  it('blocks modify_source_code at confidence 1.0 under defaults', () => {
    const d = evaluateProposal(DEFAULT_CONFIG, proposal({ actionType: 'modify_source_code', confidence: 1.0 }), ctx());
    expect(d.initialDisposition).toBe('blocked');
    expect(d.explanation).toBe('Blocked because sourceCode.modifySourceCode is disabled.');
  });
});
