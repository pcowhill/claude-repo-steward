import type { DocsPatch } from '../../core/proposals';

/**
 * Deterministic documentation patch for the `deferred` status drift
 * (PR #39 changed rollup semantics; docs/status-semantics.md and
 * docs/operator-guide.md still describe the four-status world).
 *
 * The patch is produced by code — in every analysis mode, including Live AI —
 * so its content is reviewable, reproducible, and always inside policy
 * bounds. The transformations operate on the *current* file content and fall
 * back to appending a clearly marked section if an anchor has drifted.
 */

const STATUS_ANCHOR = '- **complete** — verified done by the item owner.';
const STATUS_ADDITION = `- **complete** — verified done by the item owner.
- **deferred** — explicitly pushed past the current launch window by the
  review board. Deferred items do **not** block the rollup, but each one must
  be re-confirmed during the W-2 walkthrough.`;

const ROLLUP_ANCHOR = `1. Any **blocked** item → **NO-GO**.
2. Otherwise, any **pending** or **in-progress** item → **DEGRADED**.
3. Otherwise → **GO**.`;
const ROLLUP_REPLACEMENT = `1. Any **blocked** item → **NO-GO**.
2. Otherwise, any **pending** or **in-progress** item → **DEGRADED**.
3. Otherwise → **GO**.

**deferred** items never change the readiness level. They are reported
separately as a \`deferredCount\` on the rollup banner and in the signoff
flow, so a deferral can never silently disappear from the board's view.`;

const EXCLUSION_ANCHOR = `There is no way for an item to be excluded from the rollup: every checklist
item is either open, blocked, or complete.`;
const EXCLUSION_REPLACEMENT = `Deferral is the only way work can be excluded from the readiness level, and
it is never silent: the rollup carries a deferred count that the review board
must re-confirm before signoff.`;

const GUIDE_STATUS_ANCHOR = `- **Complete** — verified done by the item owner.`;
const GUIDE_STATUS_ADDITION = `- **Complete** — verified done by the item owner.
- **Deferred** — the review board has explicitly pushed this item past the
  current launch window. Deferred items do not block readiness, but they
  appear as a deferred count that the board re-confirms at signoff.`;

const GUIDE_SECTION_ANCHOR = `## Signoff prerequisites`;
const GUIDE_SECTION_ADDITION = `## Deferring a checklist item

Only the review board defers items. Record the board's decision in the item
notes, set the status to **Deferred** through the edit dialog, and confirm
the deferred count on the Readiness Board matches the board minutes. Every
deferral is re-confirmed during step 2 of the signoff flow.

## Signoff prerequisites`;

function apply(content: string, anchor: string, replacement: string, fallbackNote: string): string {
  if (content.includes(anchor)) {
    return content.replace(anchor, replacement);
  }
  return `${content.trimEnd()}\n\n${fallbackNote}\n`;
}

export function buildDeferredDocsPatch(current: {
  statusSemantics: string;
  operatorGuide: string;
}): DocsPatch {
  let semantics = current.statusSemantics;
  semantics = apply(
    semantics,
    STATUS_ANCHOR,
    STATUS_ADDITION,
    '- **deferred** — pushed past the current window by the review board; non-blocking but re-confirmed at W-2.',
  );
  semantics = apply(semantics, ROLLUP_ANCHOR, ROLLUP_REPLACEMENT, '');
  semantics = apply(semantics, EXCLUSION_ANCHOR, EXCLUSION_REPLACEMENT, '');

  let guide = current.operatorGuide;
  guide = apply(
    guide,
    GUIDE_STATUS_ANCHOR,
    GUIDE_STATUS_ADDITION,
    '- **Deferred** — pushed past the current window by the review board (non-blocking, re-confirmed at signoff).',
  );
  guide = apply(guide, GUIDE_SECTION_ANCHOR, GUIDE_SECTION_ADDITION, '');

  return {
    rationale:
      'PR #39 introduced the `deferred` checklist status and changed rollup semantics (deferred items are non-blocking but carry a re-confirmation obligation). docs/status-semantics.md and docs/operator-guide.md still describe the four-status model and explicitly claim no item can be excluded from the rollup, which is no longer true.',
    files: [
      {
        path: 'docs/status-semantics.md',
        newContent: semantics,
        summary: 'Document the deferred status, its rollup behavior, and the deferred-count obligation.',
      },
      {
        path: 'docs/operator-guide.md',
        newContent: guide,
        summary: 'Add Deferred to the operator status list and describe the deferral procedure.',
      },
    ],
  };
}

/** True when the main-branch docs still lack the deferred semantics. */
export function detectDeferredDocsDrift(files: {
  checklistTypes?: string;
  statusSemantics?: string;
}): boolean {
  const code = files.checklistTypes ?? '';
  const docs = files.statusSemantics ?? '';
  return code.includes("'deferred'") && !docs.toLowerCase().includes('deferred');
}
