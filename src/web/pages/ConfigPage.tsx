import { useMemo, useState } from 'react';
import { useSimState, useSimStore, useToast } from '../sim-context';
import { applyConfig } from '../../sim/engine';
import type { AutonomyLevel, StewardConfig } from '../../core/config/schema';
import { parseConfigYaml, serializeConfig } from '../../core/config/yaml';
import { COMMITTED_CONFIG_YAML } from '../../core/config/committedYaml';
import { matchPreset, PRESETS } from '../../core/config/presets';
import { diffFile } from '../../core/diff';
import { Icon } from '../components/Icon';
import { Segmented, Term } from '../components/bits';
import { DiffFileView } from '../components/DiffView';

type SectionKey = 'issueTriage' | 'pullRequestReview' | 'documentation' | 'sourceCode';

interface ActionRow {
  section: SectionKey;
  key: string;
  label: string;
  hint: string;
  lockedNote?: string;
}

const ROWS: Record<string, ActionRow[]> = {
  'Issue triage': [
    { section: 'issueTriage', key: 'addLabels', label: 'Add labels', hint: 'Apply classification/area labels to issues' },
    { section: 'issueTriage', key: 'removeLabels', label: 'Remove labels', hint: 'e.g. drop needs-repro once repro is clear' },
    { section: 'issueTriage', key: 'postComments', label: 'Post comments', hint: 'General explanatory comments' },
    { section: 'issueTriage', key: 'postReadinessAssessment', label: 'Post readiness assessment', hint: 'Classification, impact, definition-of-ready' },
    { section: 'issueTriage', key: 'askClarifyingQuestions', label: 'Ask clarifying questions', hint: 'Fill definition-of-ready gaps' },
    { section: 'issueTriage', key: 'postImplementationPlan', label: 'Post implementation plan', hint: 'Bounded fix plan grounded in the code' },
    { section: 'issueTriage', key: 'markAiCandidate', label: 'Mark as ai-candidate', hint: 'Label well-scoped issues for AI attempt' },
    { section: 'issueTriage', key: 'assignUsers', label: 'Assign users', hint: 'Also gated by safety.assignUsers' },
    { section: 'issueTriage', key: 'closeIssues', label: 'Close issues', hint: 'Also gated by safety.closeIssues' },
    { section: 'issueTriage', key: 'reopenIssues', label: 'Reopen issues', hint: 'Reopen when a regression is confirmed' },
  ],
  'Pull request review': [
    { section: 'pullRequestReview', key: 'postSummary', label: 'Post PR summary', hint: 'Reviewer-oriented change walkthrough' },
    { section: 'pullRequestReview', key: 'postReviewComment', label: 'Post review comment', hint: 'Conversation-level review notes' },
    { section: 'pullRequestReview', key: 'identifyTestGaps', label: 'Identify test gaps', hint: 'Missing unit/browser regression coverage' },
    { section: 'pullRequestReview', key: 'assessLinkedIssueCoverage', label: 'Assess linked-issue coverage', hint: 'Does the PR fix what it claims?' },
    { section: 'pullRequestReview', key: 'assessDocsImpact', label: 'Assess docs impact', hint: 'Do docs need to change with this PR?' },
    { section: 'pullRequestReview', key: 'addInlineComments', label: 'Add inline comments', hint: 'Line-anchored review comments' },
    { section: 'pullRequestReview', key: 'requestChanges', label: 'Request changes', hint: 'Formal blocking review' },
    { section: 'pullRequestReview', key: 'approvePullRequest', label: 'Approve pull request', hint: 'Formal approving review' },
  ],
  Documentation: [
    { section: 'documentation', key: 'proposeDocsPatch', label: 'Prepare docs patch', hint: 'Generate + bound-check a patch (no repo mutation)' },
    { section: 'documentation', key: 'openDraftPullRequest', label: 'Open draft docs PR', hint: 'Branch + commit + draft PR, docs paths only' },
    { section: 'documentation', key: 'updateExistingDocsBranch', label: 'Update existing docs branch', hint: 'Push follow-up commits to a steward branch' },
    { section: 'documentation', key: 'mergePullRequest', label: 'Merge docs PR', hint: 'Also gated by safety.autoMerge; executor refuses merges' },
  ],
  'Source code': [
    {
      section: 'sourceCode',
      key: 'modifySourceCode',
      label: 'Modify source code',
      hint: 'Change files outside documentation',
      lockedNote: 'The simulator executor refuses source modifications in code, whatever this is set to.',
    },
    { section: 'sourceCode', key: 'createSourceCodeBranch', label: 'Create source branch', hint: 'Branches for non-docs changes' },
  ],
};

const SAFETY_ROWS: Array<{ key: keyof StewardConfig['safety']; label: string; hint: string }> = [
  { key: 'autoMerge', label: 'Allow auto-merge', hint: 'Blocked at the executor regardless — merging is a human decision in this version' },
  { key: 'pushToProtectedBranches', label: 'Allow pushes to protected branches', hint: 'Blocked at the executor regardless' },
  { key: 'closeIssues', label: 'Allow closing issues', hint: 'Global override: false blocks close_issue everywhere' },
  { key: 'assignUsers', label: 'Allow assigning users', hint: 'Global override: false blocks assign_user everywhere' },
  { key: 'modifyWorkflowFiles', label: 'Allow workflow-file edits', hint: 'false blocks any action touching .github/workflows/**' },
];

export function ConfigPage() {
  const state = useSimState();
  const store = useSimStore();
  const toast = useToast();
  const [tab, setTab] = useState<'visual' | 'yaml'>('visual');
  const [draftYaml, setDraftYaml] = useState<string>(state.configYaml);
  const [showDiff, setShowDiff] = useState(false);

  const parsed = useMemo(() => parseConfigYaml(draftYaml), [draftYaml]);
  const draftConfig: StewardConfig | null = parsed.ok ? parsed.config : null;
  const dirty = draftYaml !== state.configYaml;
  const appliedPreset = matchPreset(state.config);
  const draftPreset = draftConfig ? matchPreset(draftConfig) : null;

  const updateDraft = (mutate: (c: StewardConfig) => void) => {
    const base: StewardConfig = draftConfig ?? JSON.parse(JSON.stringify(state.config));
    const next: StewardConfig = JSON.parse(JSON.stringify(base));
    mutate(next);
    setDraftYaml(serializeConfig(next));
  };

  const apply = () => {
    if (!parsed.ok) {
      toast('Cannot apply: the YAML is invalid. Fix the listed errors first.', 'error');
      return;
    }
    applyConfig(store, parsed.config, draftYaml, tab === 'yaml' ? 'YAML editor' : 'visual editor');
    toast('Configuration applied. Rerun a scenario to see the new policy in action.');
  };

  const download = () => {
    const blob = new Blob([draftYaml], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '.repo-steward.yml';
    a.click();
    URL.revokeObjectURL(url);
  };

  const autonomyValue = (section: SectionKey, key: string): AutonomyLevel => {
    const cfg = draftConfig ?? state.config;
    return (cfg[section] as unknown as Record<string, AutonomyLevel>)[key];
  };

  return (
    <div className="page">
      <div className="flex flex-wrap mb-16">
        <h2>Configuration</h2>
        <span className="text-muted text-small">
          The team-controlled authority boundary (<code>.repo-steward.yml</code>). The analyzer proposes; these rules decide.
        </span>
        <span className="grow" />
        {dirty ? <span className="mini-badge pending">unapplied changes</span> : <span className="mini-badge auto">in sync</span>}
        <button className="btn btn-sm" onClick={() => setShowDiff(true)} disabled={!dirty}>
          <Icon name="diff" size={12} /> Diff preview
        </button>
        <button
          className="btn btn-sm"
          onClick={() => {
            setDraftYaml(COMMITTED_CONFIG_YAML);
          }}
        >
          <Icon name="reset" size={12} /> Reset to committed defaults
        </button>
        <button className="btn btn-primary btn-sm" onClick={apply} disabled={!dirty || !parsed.ok} data-testid="apply-config">
          Apply configuration
        </button>
      </div>

      <div className="preset-cards">
        {PRESETS.map((preset) => (
          <button
            key={preset.id}
            className={`preset-card ${draftPreset === preset.id ? 'on' : ''}`}
            data-testid={`preset-${preset.id}`}
            onClick={() => {
              setDraftYaml(preset.id === 'conservative' ? COMMITTED_CONFIG_YAML : serializeConfig(preset.config));
              toast(`Preset "${preset.name}" loaded into the editor — press Apply to activate it.`);
            }}
          >
            <h4>
              {preset.name}{' '}
              {appliedPreset === preset.id ? <span className="mini-badge auto">applied</span> : draftPreset === preset.id ? <span className="mini-badge info">in editor</span> : null}
            </h4>
            <p>{preset.description}</p>
          </button>
        ))}
      </div>

      <div className="tab-nav" role="tablist" aria-label="Configuration editors">
        <button role="tab" aria-selected={tab === 'visual'} className={tab === 'visual' ? 'active' : ''} onClick={() => setTab('visual')}>
          <Icon name="gear" size={13} /> Visual editor
        </button>
        <button role="tab" aria-selected={tab === 'yaml'} className={tab === 'yaml' ? 'active' : ''} data-testid="tab-yaml" onClick={() => setTab('yaml')}>
          <Icon name="file" size={13} /> YAML
        </button>
      </div>

      {tab === 'visual' ? (
        <>
          {!parsed.ok ? (
            <div className="banner warn">
              <Icon name="alert" />
              <div>
                The YAML draft is currently invalid, so the visual editor shows the last applied configuration. Fix it in
                the YAML tab or reset to defaults.
              </div>
            </div>
          ) : null}
          <div className="config-grid">
            {Object.entries(ROWS).map(([sectionTitle, rows]) => (
              <div className="box" key={sectionTitle} style={{ marginTop: 0 }}>
                <div className="box-header">
                  <span className="title">{sectionTitle}</span>
                </div>
                {rows.map((row) => (
                  <div className="config-row" key={row.key} data-testid={`config-${row.section}-${row.key}`}>
                    <div className="cfg-label">
                      {row.label}
                      <span className="hint">
                        {row.hint}
                        {row.lockedNote ? (
                          <>
                            {' '}
                            <b>
                              <Icon name="lock" size={10} /> {row.lockedNote}
                            </b>
                          </>
                        ) : null}
                      </span>
                    </div>
                    <Segmented<AutonomyLevel>
                      ariaLabel={`${row.label} autonomy`}
                      value={autonomyValue(row.section, row.key)}
                      options={[
                        { value: 'disabled', label: 'Disabled', title: 'Never executes; recorded as blocked' },
                        { value: 'propose', label: 'Propose', title: 'Waits in the Steward Inbox for approval' },
                        { value: 'automatic', label: 'Automatic', title: 'Executes when confidence + safety checks pass' },
                      ]}
                      onChange={(v) =>
                        updateDraft((c) => {
                          (c[row.section] as unknown as Record<string, AutonomyLevel>)[row.key] = v;
                        })
                      }
                    />
                  </div>
                ))}
              </div>
            ))}

            <div className="box" style={{ marginTop: 0 }}>
              <div className="box-header">
                <span className="title">Confidence thresholds</span>
              </div>
              <div className="box-body text-small">
                <label className="field">
                  <span>
                    Minimum <Term word="confidence">proposal confidence</Term> — below this, proposals are blocked
                  </span>
                  <input
                    type="number"
                    className="control"
                    min={0}
                    max={1}
                    step={0.01}
                    value={(draftConfig ?? state.config).analysis.minimumProposalConfidence}
                    data-testid="min-proposal-confidence"
                    onChange={(e) =>
                      updateDraft((c) => {
                        c.analysis.minimumProposalConfidence = Number(e.target.value);
                      })
                    }
                  />
                </label>
                <label className="field">
                  <span>Minimum automatic confidence — below this, automatic actions cannot self-execute</span>
                  <input
                    type="number"
                    className="control"
                    min={0}
                    max={1}
                    step={0.01}
                    value={(draftConfig ?? state.config).analysis.minimumAutomaticConfidence}
                    data-testid="min-auto-confidence"
                    onChange={(e) =>
                      updateDraft((c) => {
                        c.analysis.minimumAutomaticConfidence = Number(e.target.value);
                      })
                    }
                  />
                </label>
                <label className="flex" style={{ gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={(draftConfig ?? state.config).analysis.downgradeAutomaticBelowThreshold}
                    onChange={(e) =>
                      updateDraft((c) => {
                        c.analysis.downgradeAutomaticBelowThreshold = e.target.checked;
                      })
                    }
                  />
                  <span>
                    <Term word="downgraded">Downgrade</Term> low-confidence automatic actions to proposals (instead of blocking)
                  </span>
                </label>
              </div>
            </div>

            <div className="box" style={{ marginTop: 0 }}>
              <div className="box-header">
                <span className="title">Documentation bounds</span>
              </div>
              <div className="box-body text-small">
                <div className="flex" style={{ gap: 16 }}>
                  <label className="field grow">
                    <span>Max files changed</span>
                    <input
                      type="number"
                      className="control"
                      min={1}
                      value={(draftConfig ?? state.config).documentation.maxFilesChanged}
                      onChange={(e) =>
                        updateDraft((c) => {
                          c.documentation.maxFilesChanged = Number(e.target.value);
                        })
                      }
                    />
                  </label>
                  <label className="field grow">
                    <span>Max lines changed</span>
                    <input
                      type="number"
                      className="control"
                      min={1}
                      value={(draftConfig ?? state.config).documentation.maxLinesChanged}
                      onChange={(e) =>
                        updateDraft((c) => {
                          c.documentation.maxLinesChanged = Number(e.target.value);
                        })
                      }
                    />
                  </label>
                </div>
                <label className="field">
                  <span>Editable paths (one glob per line)</span>
                  <textarea
                    className="control mono"
                    rows={3}
                    value={(draftConfig ?? state.config).documentation.editablePaths.join('\n')}
                    onChange={(e) =>
                      updateDraft((c) => {
                        c.documentation.editablePaths = e.target.value.split('\n').map((s) => s.trim()).filter(Boolean);
                      })
                    }
                  />
                </label>
                <label className="field">
                  <span>Forbidden paths (always win over editable)</span>
                  <textarea
                    className="control mono"
                    rows={4}
                    value={(draftConfig ?? state.config).documentation.forbiddenPaths.join('\n')}
                    onChange={(e) =>
                      updateDraft((c) => {
                        c.documentation.forbiddenPaths = e.target.value.split('\n').map((s) => s.trim()).filter(Boolean);
                      })
                    }
                  />
                </label>
              </div>
            </div>

            <div className="box" style={{ marginTop: 0 }}>
              <div className="box-header">
                <span className="title">Safety overrides</span>
                <span className="text-small text-muted">apply regardless of confidence or autonomy</span>
              </div>
              {SAFETY_ROWS.map((row) => (
                <div className="config-row" key={row.key}>
                  <div className="cfg-label">
                    {row.label}
                    <span className="hint">{row.hint}</span>
                  </div>
                  <input
                    type="checkbox"
                    aria-label={row.label}
                    checked={(draftConfig ?? state.config).safety[row.key]}
                    onChange={(e) =>
                      updateDraft((c) => {
                        c.safety[row.key] = e.target.checked;
                      })
                    }
                  />
                </div>
              ))}
            </div>
          </div>
        </>
      ) : (
        <div className="box" style={{ marginTop: 0 }}>
          <div className="box-header">
            <span className="title mono" style={{ fontSize: 13 }}>
              .repo-steward.yml
            </span>
            <span className={`mini-badge ${parsed.ok ? 'auto' : 'blocked'}`} data-testid="yaml-validity">
              {parsed.ok ? 'valid' : 'invalid'}
            </span>
            <span className="grow" />
            <button
              className="btn btn-sm"
              onClick={() => {
                void navigator.clipboard.writeText(draftYaml).then(
                  () => toast('YAML copied to clipboard.'),
                  () => toast('Clipboard unavailable in this browser context.', 'error'),
                );
              }}
            >
              Copy
            </button>
            <button className="btn btn-sm" onClick={download}>
              Download
            </button>
          </div>
          <textarea
            className="yaml-editor mono"
            spellCheck={false}
            value={draftYaml}
            data-testid="yaml-editor"
            aria-label="Configuration YAML"
            onChange={(e) => setDraftYaml(e.target.value)}
          />
          {!parsed.ok ? (
            <ul className="error-list" data-testid="yaml-errors">
              {parsed.errors.map((err, i) => (
                <li key={i}>
                  <code>{err.path}</code>: {err.message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}

      {showDiff ? (
        <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setShowDiff(false)}>
          <div className="dialog wide" role="dialog" aria-modal="true" aria-label="Configuration diff preview">
            <header>
              Changes vs. applied configuration
              <button className="btn btn-sm btn-invisible" onClick={() => setShowDiff(false)} aria-label="Close">
                <Icon name="x" />
              </button>
            </header>
            <div className="dialog-body" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
              <DiffFileView diff={diffFile('.repo-steward.yml', state.configYaml, draftYaml)} />
            </div>
            <footer>
              <button className="btn" onClick={() => setShowDiff(false)}>
                Close
              </button>
              <button
                className="btn btn-primary"
                disabled={!parsed.ok}
                onClick={() => {
                  setShowDiff(false);
                  apply();
                }}
              >
                Apply these changes
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      <div className="banner info mt-16">
        <Icon name="shield" />
        <div>
          <b>Defense in depth:</b> these rules are evaluated by deterministic code, and the executor independently
          refuses source-code modification, pushes to protected branches, and merges — even a hand-edited YAML granting
          them cannot make those actions run. Configuration changes take effect on the next steward run. (Visual edits
          regenerate the YAML, so comments in the committed file are preserved only until the first visual edit.)
        </div>
      </div>
    </div>
  );
}
