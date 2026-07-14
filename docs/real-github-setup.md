# Real GitHub setup (dry-run first)

The simulator needs none of this. This guide covers running the same pipeline — adapter → analyzer → schema validation → policy → executor — against real GitHub events.

## What the real path can and cannot do

| Capability | Status |
| --- | --- |
| Normalize `issues` / `pull_request` webhook payloads | ✅ implemented (`src/github/adapter.ts`) |
| Deterministic analysis of the payload (labels, DoR, test-gap, linked issues) | ✅ implemented (`src/github/analyzer.ts`) |
| Policy evaluation with `.repo-steward.yml` | ✅ same engine as the simulator |
| Dry-run logging of every would-be action | ✅ default behavior |
| Post issue/PR comments, add/remove labels | ✅ opt-in only (see below) |
| Create branches, commits, or documentation PRs | ❌ intentionally **not implemented** in this version (simulator only) |
| Approve, request changes, merge, push, close, assign | ❌ refused in code, regardless of configuration |

## Local dry runs with fixtures

```bash
npm run steward -- --event src/github/fixtures/issue-opened.json
npm run steward -- --event src/github/fixtures/pull-request-opened.json \
  --changed-files src/state/readinessStore.ts,tests/readinessStore.test.ts
npm run steward -- --event src/github/fixtures/pull-request-merged.json
npm run steward -- --help
```

The CLI prints the normalized event, the analysis summary, and per-proposal policy dispositions (`AUTO` / `PROPOSE` / `BLOCKED`) with the exact rule text, then a `[dry-run] would …` line for anything that would have executed.

You can also exercise the pipeline over HTTP while the dev server runs:

```bash
curl -s -X POST localhost:8787/api/github/dry-run \
  -H 'Content-Type: application/json' \
  -d "{\"payload\": $(cat src/github/fixtures/issue-opened.json)}" | jq .
```

## Enabling real writes (comments + labels only)

Three conditions must all hold — miss any one and the run stays dry:

1. the `--execute` flag is passed;
2. the environment variable `REPO_STEWARD_WRITE=true` is set;
3. a `GITHUB_TOKEN` (or `GH_TOKEN`) is present.

```bash
REPO_STEWARD_WRITE=true GITHUB_TOKEN=... \
  npm run steward -- --event event.json --execute
```

Even then, `RealGithubExecutor` implements exactly two write shapes — `POST …/issues/:n/comments` and add/remove label — and refuses every other action type in code.

## GitHub Actions

Copy the workflows from [`examples/github-workflows/`](../examples/github-workflows/) into `.github/workflows/` of the target repository:

- **`repo-steward-issue-triage.yml`** — `on: issues` (opened/edited/reopened). Permissions: `contents: read`, `issues: write`.
- **`repo-steward-pr-review.yml`** — `on: pull_request`. Permissions: `contents: read`, `pull-requests: write`. It deliberately uses the plain `pull_request` trigger and **never checks out PR head code**: changed files come from the REST API, so untrusted code is never executed with secrets available (no `pull_request_target` + checkout pattern). Fork PRs get a read-only token and are dry-run by construction.
- **`repo-steward-manual.yml`** — `workflow_dispatch` replay of a bundled fixture, `contents: read` only.

All three use the built-in `GITHUB_TOKEN` — no personal access token — and default to dry-run. To let the first two write comments/labels, set the repository **variable** `REPO_STEWARD_WRITE` to `true` (Settings → Secrets and variables → Actions → Variables). Delete the variable to fall back to dry-run instantly.

`.repo-steward.yml` at the repository root governs the run exactly as in the simulator; if it is missing the committed defaults apply, and if it is invalid the run exits with the validation errors rather than guessing.

## Safety posture recap

- Dry-run by default, everywhere; writing is a double opt-in (flag + env) plus a token.
- Narrow workflow permissions; no secrets exposed to untrusted PR code.
- Never merges, never pushes, never modifies files, never closes or assigns — enforced in `src/github/executors.ts`, not in prompt text or UI.
- The GitHub analyzer is deterministic in this version. If you wire Live AI into a workflow later, treat issue/PR text as untrusted model input exactly as the backend does (`server/ai/prompt.ts` fences it), and keep the policy file authoritative.
