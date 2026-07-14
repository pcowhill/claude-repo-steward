import express from 'express';
import { z } from 'zod';
import { PORT, resolveProvider } from './env';
import { AiError, runLiveAnalysis } from './ai/provider';
import { NormalizedEventSchema } from '../src/core/events';
import { parseConfigYaml } from '../src/core/config/yaml';
import { DEFAULT_CONFIG } from '../src/core/config/defaults';
import { adaptGithubEvent, GithubAdapterError } from '../src/github/adapter';
import { analyzeGithubEvent } from '../src/github/analyzer';
import { validateProposals } from '../src/core/proposals';
import { evaluateProposal } from '../src/core/policy/engine';

/**
 * Repo Steward backend.
 *
 * Responsibilities: Live AI analysis (keys stay here), config validation,
 * and the GitHub dry-run pipeline. It holds no state — the simulator lives
 * entirely in the browser. Errors are typed; stack traces and secrets never
 * reach the client.
 */

const app = express();
app.use(express.json({ limit: '1mb' }));

const sendError = (res: express.Response, status: number, code: string, message: string) => {
  res.status(status).json({ ok: false, error: { code, message } });
};

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'repo-steward-backend', version: 1 });
});

app.get('/api/ai/status', (_req, res) => {
  const provider = resolveProvider();
  res.json({
    ok: true,
    configured: provider !== null,
    provider: provider?.provider ?? null,
    model: provider?.model ?? null,
  });
});

const AnalyzeRequestSchema = z.object({
  event: NormalizedEventSchema,
  context: z.record(z.unknown()),
});

app.post('/api/analyze', async (req, res) => {
  const parsed = AnalyzeRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 400, 'invalid_request', 'Request body must contain a normalized event and a context object.');
    return;
  }
  const provider = resolveProvider();
  if (!provider) {
    sendError(
      res,
      503,
      'not_configured',
      'Live AI mode is not configured. Set ANTHROPIC_API_KEY (and optionally ANTHROPIC_MODEL) or OPENAI_API_KEY/OPENAI_MODEL in .env, then restart the backend.',
    );
    return;
  }
  // Bound the context payload so a client cannot ship the whole repository.
  const contextSize = JSON.stringify(parsed.data.context).length;
  if (contextSize > 200_000) {
    sendError(res, 413, 'context_too_large', 'Analysis context exceeds the 200KB bound.');
    return;
  }
  try {
    const analysis = await runLiveAnalysis(provider, parsed.data.event, parsed.data.context);
    res.json({ ok: true, provider: provider.provider, model: provider.model, analysis });
  } catch (err) {
    if (err instanceof AiError) {
      const status = err.code === 'timeout' ? 504 : err.code === 'not_configured' ? 503 : 502;
      sendError(res, status, err.code, err.message);
      return;
    }
    console.error('analyze failed:', err instanceof Error ? err.message : err);
    sendError(res, 500, 'internal', 'Live analysis failed unexpectedly. Repository state is unchanged.');
  }
});

const ValidateConfigSchema = z.object({ yaml: z.string().max(100_000) });

app.post('/api/validate-config', (req, res) => {
  const parsed = ValidateConfigSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 400, 'invalid_request', 'Body must be { "yaml": string }.');
    return;
  }
  const result = parseConfigYaml(parsed.data.yaml);
  if (result.ok) {
    res.json({ ok: true, valid: true, config: result.config });
  } else {
    res.json({ ok: true, valid: false, errors: result.errors });
  }
});

const DryRunSchema = z.object({
  payload: z.record(z.unknown()),
  changedFiles: z.array(z.string()).max(500).optional(),
  configYaml: z.string().max(100_000).optional(),
});

app.post('/api/github/dry-run', (req, res) => {
  const parsed = DryRunSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 400, 'invalid_request', 'Body must be { payload, changedFiles?, configYaml? }.');
    return;
  }
  let config = DEFAULT_CONFIG;
  if (parsed.data.configYaml) {
    const configResult = parseConfigYaml(parsed.data.configYaml);
    if (!configResult.ok) {
      sendError(res, 400, 'invalid_config', `configYaml is invalid: ${configResult.errors[0]?.path} ${configResult.errors[0]?.message}`);
      return;
    }
    config = configResult.config;
  }
  try {
    const event = adaptGithubEvent(parsed.data.payload, { changedFiles: parsed.data.changedFiles });
    const analysis = analyzeGithubEvent(event);
    const { valid, invalid } = validateProposals(analysis.proposals as unknown[]);
    const decisions = valid.map((proposal) => {
      const decision = evaluateProposal(config, proposal, {
        now: () => new Date().toISOString(),
        makeId: () => `${proposal.id}-dec`,
      });
      return {
        proposal,
        decision,
        plannedAction:
          decision.initialDisposition === 'executed'
            ? `[dry-run] would execute: ${proposal.title}`
            : decision.initialDisposition === 'blocked'
              ? `blocked: ${proposal.title}`
              : `awaiting approval: ${proposal.title}`,
      };
    });
    res.json({
      ok: true,
      dryRun: true,
      event,
      analysis: { summary: analysis.summary, evidence: analysis.evidence },
      rejectedProposals: invalid.map((i) => i.errors),
      results: decisions,
    });
  } catch (err) {
    if (err instanceof GithubAdapterError) {
      sendError(res, 400, 'unsupported_payload', err.message);
      return;
    }
    console.error('dry-run failed:', err instanceof Error ? err.message : err);
    sendError(res, 500, 'internal', 'Dry run failed unexpectedly.');
  }
});

app.use((_req, res) => {
  sendError(res, 404, 'not_found', 'Unknown API route.');
});

// Final error guard: no stack traces to the browser.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('unhandled:', err instanceof Error ? err.message : err);
  sendError(res, 500, 'internal', 'Unexpected server error.');
});

app.listen(PORT, () => {
  const provider = resolveProvider();
  console.log(`repo-steward backend on :${PORT} — live AI ${provider ? `configured (${provider.provider}/${provider.model})` : 'not configured (scripted + mock modes unaffected)'}`);
});
