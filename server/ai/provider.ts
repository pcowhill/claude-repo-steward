import Anthropic from '@anthropic-ai/sdk';
import { LiveAnalysisResponseSchema, type LiveAnalysisResponse } from '../../src/core/analysis';
import { AI_TIMEOUT_MS, type ProviderConfig } from '../env';
import { buildUserPrompt, REPAIR_PROMPT, SYSTEM_PROMPT } from './prompt';

/**
 * Provider calls for Live AI mode. Model output is untrusted: it is parsed,
 * Zod-validated, and — if invalid — retried once with a repair instruction.
 * A second failure returns a typed, non-destructive error; nothing is ever
 * executed from a partially parsed response.
 */

export type AiErrorCode =
  | 'not_configured'
  | 'timeout'
  | 'provider_error'
  | 'refusal'
  | 'truncated'
  | 'invalid_output';

export class AiError extends Error {
  constructor(
    public code: AiErrorCode,
    message: string,
  ) {
    super(message);
  }
}

interface Turn {
  role: 'user' | 'assistant';
  content: string;
}

async function callAnthropic(config: ProviderConfig, turns: Turn[]): Promise<string> {
  const client = new Anthropic({ apiKey: config.apiKey, timeout: AI_TIMEOUT_MS, maxRetries: 1 });
  let response: Anthropic.Message;
  try {
    // `thinking` is deliberately omitted so any configured model id works —
    // models with always-on/adaptive thinking use their defaults.
    response = await client.messages.create({
      model: config.model,
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages: turns.map((t) => ({ role: t.role, content: t.content })),
    });
  } catch (err) {
    if (err instanceof Anthropic.APIConnectionTimeoutError) {
      throw new AiError('timeout', 'Anthropic request timed out.');
    }
    if (err instanceof Anthropic.AuthenticationError) {
      throw new AiError('provider_error', 'Anthropic rejected the API key (authentication error).');
    }
    if (err instanceof Anthropic.RateLimitError) {
      throw new AiError('provider_error', 'Anthropic rate limit reached. Try again shortly.');
    }
    if (err instanceof Anthropic.NotFoundError) {
      throw new AiError('provider_error', `Anthropic model "${config.model}" was not found. Check ANTHROPIC_MODEL.`);
    }
    if (err instanceof Anthropic.APIError) {
      throw new AiError('provider_error', `Anthropic API error (${err.status ?? 'network'}).`);
    }
    throw new AiError('provider_error', 'Could not reach the Anthropic API.');
  }
  if (response.stop_reason === 'refusal') {
    throw new AiError('refusal', 'The model declined to analyze this event.');
  }
  if (response.stop_reason === 'max_tokens') {
    throw new AiError('truncated', 'Model output was truncated before completing the JSON response.');
  }
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
  if (!text.trim()) {
    throw new AiError('invalid_output', 'Model returned no text content.');
  }
  return text;
}

async function callOpenAi(config: ProviderConfig, turns: Turn[]): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          ...turns.map((t) => ({ role: t.role, content: t.content })),
        ],
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new AiError('timeout', 'OpenAI request timed out.');
    }
    throw new AiError('provider_error', 'Could not reach the OpenAI API.');
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401) throw new AiError('provider_error', 'OpenAI rejected the API key (401).');
  if (res.status === 404) {
    throw new AiError('provider_error', `OpenAI model "${config.model}" was not found. Check OPENAI_MODEL.`);
  }
  if (res.status === 429) throw new AiError('provider_error', 'OpenAI rate limit reached. Try again shortly.');
  if (!res.ok) throw new AiError('provider_error', `OpenAI API error (${res.status}).`);
  const body = (await res.json().catch(() => null)) as {
    choices?: Array<{ message?: { content?: string; refusal?: string | null }; finish_reason?: string }>;
  } | null;
  const choice = body?.choices?.[0];
  if (!choice) throw new AiError('invalid_output', 'OpenAI returned no choices.');
  if (choice.message?.refusal) throw new AiError('refusal', 'The model declined to analyze this event.');
  if (choice.finish_reason === 'length') {
    throw new AiError('truncated', 'Model output was truncated before completing the JSON response.');
  }
  const text = choice.message?.content ?? '';
  if (!text.trim()) throw new AiError('invalid_output', 'OpenAI returned empty content.');
  return text;
}

function tryParse(text: string): { ok: true; value: LiveAnalysisResponse } | { ok: false; error: string } {
  // Tolerate accidental markdown fencing, then require valid JSON + schema.
  const stripped = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '');
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    return { ok: false, error: 'not valid JSON' };
  }
  const result = LiveAnalysisResponseSchema.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      error: result.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; '),
    };
  }
  return { ok: true, value: result.data };
}

/** One analysis round-trip with a single schema-repair retry. */
export async function runLiveAnalysis(
  config: ProviderConfig,
  event: unknown,
  context: unknown,
): Promise<LiveAnalysisResponse> {
  const call = config.provider === 'anthropic' ? callAnthropic : callOpenAi;
  const turns: Turn[] = [{ role: 'user', content: buildUserPrompt(event, context) }];

  const first = await call(config, turns);
  const firstParse = tryParse(first);
  if (firstParse.ok) return firstParse.value;

  // Retry once with a repair instruction referencing the invalid output.
  turns.push({ role: 'assistant', content: first });
  turns.push({ role: 'user', content: `${REPAIR_PROMPT}\n\nValidation problems: ${firstParse.error}` });
  const second = await call(config, turns);
  const secondParse = tryParse(second);
  if (secondParse.ok) return secondParse.value;

  throw new AiError(
    'invalid_output',
    `Model output failed schema validation twice (${secondParse.error}). No actions were taken; the event and repository state are preserved.`,
  );
}
