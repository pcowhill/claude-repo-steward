import YAML from 'yaml';
import { StewardConfigSchema, type StewardConfig } from './schema';

export interface ConfigError {
  path: string;
  message: string;
}

export type ParseConfigResult =
  | { ok: true; config: StewardConfig }
  | { ok: false; errors: ConfigError[] };

/** Parse and validate `.repo-steward.yml` text. Never throws. */
export function parseConfigYaml(text: string): ParseConfigResult {
  let doc: unknown;
  try {
    doc = YAML.parse(text);
  } catch (err) {
    return {
      ok: false,
      errors: [{ path: '(yaml)', message: err instanceof Error ? err.message : 'Invalid YAML' }],
    };
  }
  if (doc === null || doc === undefined) {
    return { ok: false, errors: [{ path: '(root)', message: 'Configuration is empty' }] };
  }
  const parsed = StewardConfigSchema.safeParse(doc);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.') || '(root)',
        message:
          issue.code === 'unrecognized_keys'
            ? `Unknown key(s): ${(issue as { keys?: string[] }).keys?.join(', ')}`
            : issue.message,
      })),
    };
  }
  return { ok: true, config: parsed.data };
}

/** Serialize a config back to YAML in the canonical key order. */
export function serializeConfig(config: StewardConfig): string {
  return YAML.stringify(config, { indent: 2, lineWidth: 100 });
}
