import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { adaptGithubEvent } from './adapter';
import { analyzeGithubEvent } from './analyzer';
import { validateProposals } from '../core/proposals';
import { evaluateProposal } from '../core/policy/engine';
import { parseConfigYaml } from '../core/config/yaml';
import { DEFAULT_CONFIG } from '../core/config/defaults';
import { DryRunExecutor, RealGithubExecutor } from './executors';

/**
 * Repo Steward GitHub runner.
 *
 *   npm run steward -- --event src/github/fixtures/issue-opened.json
 *   npm run steward -- --event "$GITHUB_EVENT_PATH" --config .repo-steward.yml
 *   REPO_STEWARD_WRITE=true GITHUB_TOKEN=... npm run steward -- --event ... --execute
 *
 * Dry-run by default. Writing requires BOTH the --execute flag AND
 * REPO_STEWARD_WRITE=true AND a GITHUB_TOKEN — and even then only comments
 * and labels are possible. Never merges, never pushes, never edits files.
 */

interface CliArgs {
  eventPath: string | null;
  configPath: string;
  changedFiles: string[];
  execute: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    eventPath: null,
    configPath: '.repo-steward.yml',
    changedFiles: [],
    execute: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--event') args.eventPath = argv[++i];
    else if (arg === '--config') args.configPath = argv[++i];
    else if (arg === '--changed-files') args.changedFiles = (argv[++i] ?? '').split(',').filter(Boolean);
    else if (arg === '--execute') args.execute = true;
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }
  return args;
}

function printHelp(): void {
  console.log(`Repo Steward GitHub runner (dry-run by default)

Options:
  --event <path>           GitHub webhook payload JSON (required).
                           In Actions, pass "$GITHUB_EVENT_PATH".
  --config <path>          Policy config (default .repo-steward.yml)
  --changed-files <a,b,c>  Changed paths for PR events
  --execute                Attempt real writes (comments/labels only).
                           Also requires REPO_STEWARD_WRITE=true and
                           GITHUB_TOKEN. Otherwise stays dry-run.
`);
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.eventPath) {
    printHelp();
    console.error('error: --event is required');
    return 2;
  }

  // 1. Load config (fall back to committed defaults with a warning).
  let config = DEFAULT_CONFIG;
  try {
    const text = readFileSync(resolve(args.configPath), 'utf8');
    const parsed = parseConfigYaml(text);
    if (!parsed.ok) {
      console.error(`error: ${args.configPath} is invalid:`);
      for (const e of parsed.errors) console.error(`  - ${e.path}: ${e.message}`);
      return 2;
    }
    config = parsed.config;
  } catch {
    console.warn(`warning: could not read ${args.configPath}; using committed defaults`);
  }

  // 2. Normalize the GitHub payload.
  const raw = JSON.parse(readFileSync(resolve(args.eventPath), 'utf8'));
  const event = adaptGithubEvent(raw, { changedFiles: args.changedFiles });
  console.log(`event    ${event.type} → ${event.target.kind} #${'number' in event.target ? event.target.number : ''} (${event.repository.owner}/${event.repository.name})`);

  // 3. Analyze (deterministic rules — same schema as every other mode).
  const analysis = analyzeGithubEvent(event);
  console.log(`analysis ${analysis.summary}`);

  // 4. Schema-validate proposals.
  const { valid, invalid } = validateProposals(analysis.proposals as unknown[]);
  for (const failure of invalid) {
    console.log(`rejected out-of-schema proposal: ${failure.errors.join('; ')}`);
  }

  // 5. Decide execution mode.
  const wantWrite = args.execute;
  const writeEnabled = process.env.REPO_STEWARD_WRITE === 'true';
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? '';
  const canWrite = wantWrite && writeEnabled && token.length > 0;
  if (wantWrite && !canWrite) {
    console.log(
      `note     --execute requested but ${!writeEnabled ? 'REPO_STEWARD_WRITE!=true' : 'no GITHUB_TOKEN'} — staying in dry-run.`,
    );
  }
  const executor = canWrite
    ? new RealGithubExecutor({ token, owner: event.repository.owner, repo: event.repository.name })
    : new DryRunExecutor();
  console.log(`mode     ${canWrite ? 'EXECUTE (comments + labels only)' : 'DRY RUN'}`);

  // 6. Policy → (maybe) execute. Identical engine to the simulator.
  let executed = 0;
  let pending = 0;
  let blocked = 0;
  for (const proposal of valid) {
    const decision = evaluateProposal(config, proposal, {
      now: () => new Date().toISOString(),
      makeId: () => `${proposal.id}-dec`,
    });
    const flag =
      decision.initialDisposition === 'executed'
        ? 'AUTO   '
        : decision.initialDisposition === 'blocked'
          ? 'BLOCKED'
          : 'PROPOSE';
    console.log(`${flag}  ${proposal.title} (confidence ${proposal.confidence.toFixed(2)})`);
    console.log(`         ${decision.explanation}`);
    if (decision.initialDisposition === 'executed') {
      const result = await executor.execute(proposal, decision);
      console.log(`         ${result.summary}`);
      if (result.ok) executed += 1;
    } else if (decision.initialDisposition === 'blocked') {
      blocked += 1;
    } else {
      pending += 1;
      console.log('         (approval flows are simulator/UI only — recorded as pending)');
    }
  }

  console.log(
    `\ndone     ${executed} executed${canWrite ? '' : ' (dry-run)'}, ${pending} awaiting approval, ${blocked} blocked`,
  );
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('error:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
