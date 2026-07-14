/**
 * Backend environment loading. Keys live here and only here — no route ever
 * serializes them, and /api/ai/status reports booleans, not values.
 */

try {
  process.loadEnvFile('.env');
} catch {
  // No .env file — fine; Live AI mode simply reports "not configured".
}

export interface ProviderConfig {
  provider: 'anthropic' | 'openai';
  apiKey: string;
  model: string;
}

const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-4-8';
const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';

/** Prefer Anthropic when both providers are configured. */
export function resolveProvider(): ProviderConfig | null {
  const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (anthropicKey) {
    return {
      provider: 'anthropic',
      apiKey: anthropicKey,
      model: process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_ANTHROPIC_MODEL,
    };
  }
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  if (openaiKey) {
    return {
      provider: 'openai',
      apiKey: openaiKey,
      model: process.env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL,
    };
  }
  return null;
}

export const PORT = Number(process.env.PORT ?? 8787);
export const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS ?? 45_000);
