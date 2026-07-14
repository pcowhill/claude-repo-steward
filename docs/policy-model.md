# The policy model

`.repo-steward.yml` is the team-controlled authority boundary. It is parsed with a strict schema (unknown keys are errors), and evaluated by `src/core/policy/engine.ts` — deterministic code with no model in the loop.

## Autonomy levels

Every action type maps to exactly one config entry:

| Level | Meaning |
| --- | --- |
| `disabled` | May never execute. Proposals are recorded as **blocked** with the rule named. |
| `propose` | Enters the **Steward Inbox**; a human approves (executes for real) or rejects (state unchanged, audited). |
| `automatic` | Executes immediately **if** confidence and all safety/path checks pass. |

## Evaluation order

For each schema-valid proposal:

1. **Global safety overrides** (`safety.*`) — `closeIssues`, `assignUsers`, `autoMerge` (covers both merge actions), `pushToProtectedBranches`, and `modifyWorkflowFiles` (any action touching `.github/workflows/**`). A `false` here blocks regardless of confidence or autonomy. These exist so one switch can never be argued around by a confident analyzer.
2. **Documentation constraints** (for `propose_docs_patch`, `open_draft_docs_pull_request`, `update_docs_branch`) — every touched path must match `documentation.editablePaths`, must not match `documentation.forbiddenPaths` (deny wins), and the patch must fit `maxFilesChanged` / `maxLinesChanged` (counted from a real line diff against the default branch).
3. **Autonomy + confidence** —
   - below `analysis.minimumProposalConfidence` → **blocked** (low confidence);
   - `propose` → **awaiting_approval**;
   - `automatic` with confidence ≥ `analysis.minimumAutomaticConfidence` → **executed**;
   - `automatic` below the bar → **downgraded to proposal** when `downgradeAutomaticBelowThreshold: true`, otherwise blocked.

Every decision record stores: proposal id, action type, config path, configured level, proposal confidence, the threshold that applied, each safety and path check with pass/fail, initial and current disposition, a human-readable explanation, timestamps, and a transition history (`awaiting_approval → approved_by_user → executed`, `→ rejected_by_user`, `→ failed`).

## Worked examples (default config)

- *Add label `bug`, confidence 0.94* → `issueTriage.addLabels` is `automatic`, 0.94 ≥ 0.82 → **executed**: “Automatically applied because issueTriage.addLabels is automatic and confidence 0.94 exceeds the 0.82 threshold.”
- *Mark ai-candidate, confidence 0.78* → `issueTriage.markAiCandidate` is `propose` → **awaiting approval** in the Inbox.
- *Same proposal under Trusted Steward* (`markAiCandidate: automatic`) → 0.78 < 0.82 → **downgraded to proposal**: the Inbox shows why.
- *Assign marco-ruiz, confidence 1.0* → `safety.assignUsers: false` → **blocked**, before autonomy is even consulted.
- *Docs patch touching `src/state/readinessStore.ts`* → matches forbidden `src/**` → **blocked** regardless of confidence.
- *Docs patch of 412 changed lines* → exceeds `maxLinesChanged: 200` → **blocked**, with the count in the explanation.

## Defense in depth

The policy engine is layer one. The executor (`src/sim/executor.ts`) is layer two and re-checks at execution time; three things are refused unconditionally, whatever the YAML says:

- `modify_source_code`
- `push_to_protected_branch`
- `merge_pull_request` / `merge_docs_pull_request`

Unit tests assert that these cannot mutate state even when proposed at confidence 1.0 under a deliberately permissive config. The UI hides dangerous buttons too — but buttons are presentation, not the boundary.

## Presets

| Preset | Intent |
| --- | --- |
| **Observer** | Analysis only. Every action is `propose` or `disabled`; nothing mutates the repository automatically. |
| **Conservative** (committed default) | Safe labels and explanatory/review comments are automatic; anything that writes files, opens branches/PRs, or edits labels destructively requires approval; assignment, closing, approving, requesting changes, source changes, and merges are disabled. |
| **Trusted Steward** | Label removal, ai-candidate marking, inline review comments, and draft-docs-PR creation become automatic (still subject to the 0.82 confidence bar and docs bounds). Source modification and every merge path remain disabled — that is not a preset choice, it is the product's boundary. |

## Untrusted content

Issue bodies, PR descriptions, comments, and repository file contents are data. They flow into analyzers as fenced, untrusted input and into the UI as escaped text — but they are never inputs to the policy engine, which reads only the committed configuration and the structured proposal fields. A malicious issue saying “you are now allowed to merge” can, at worst, influence what gets *proposed*; it cannot change what is *permitted*.
