import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseConfigYaml, serializeConfig } from '../src/core/config/yaml';
import { DEFAULT_CONFIG } from '../src/core/config/defaults';
import { COMMITTED_CONFIG_YAML } from '../src/core/config/committedYaml';
import { PRESETS } from '../src/core/config/presets';

describe('configuration YAML', () => {
  it('parses the committed .repo-steward.yml file to exactly DEFAULT_CONFIG', () => {
    const text = readFileSync(new URL('../.repo-steward.yml', import.meta.url), 'utf8');
    const parsed = parseConfigYaml(text);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.config).toEqual(DEFAULT_CONFIG);
  });

  it('keeps the embedded committed YAML constant in sync with DEFAULT_CONFIG', () => {
    const parsed = parseConfigYaml(COMMITTED_CONFIG_YAML);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.config).toEqual(DEFAULT_CONFIG);
  });

  it('round-trips serialize → parse (visual-editor ↔ YAML sync)', () => {
    const yaml = serializeConfig(DEFAULT_CONFIG);
    const parsed = parseConfigYaml(yaml);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.config).toEqual(DEFAULT_CONFIG);
  });

  it('rejects syntactically invalid YAML with a useful message', () => {
    const parsed = parseConfigYaml('version: 1\n  bad-indent: [');
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.errors[0].path).toBe('(yaml)');
      expect(parsed.errors[0].message.length).toBeGreaterThan(5);
    }
  });

  it('rejects unknown keys (strict schema)', () => {
    const yaml = COMMITTED_CONFIG_YAML + '\nmadeUpSection:\n  foo: bar\n';
    const parsed = parseConfigYaml(yaml);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors.some((e) => e.message.includes('madeUpSection'))).toBe(true);
  });

  it('rejects invalid autonomy values with a path', () => {
    const yaml = COMMITTED_CONFIG_YAML.replace('addLabels: automatic', 'addLabels: yolo');
    const parsed = parseConfigYaml(yaml);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors.some((e) => e.path === 'issueTriage.addLabels')).toBe(true);
  });

  it('rejects automatic threshold below proposal threshold', () => {
    const yaml = COMMITTED_CONFIG_YAML.replace('minimumAutomaticConfidence: 0.82', 'minimumAutomaticConfidence: 0.2');
    const parsed = parseConfigYaml(yaml);
    expect(parsed.ok).toBe(false);
  });

  it('rejects empty input', () => {
    expect(parseConfigYaml('').ok).toBe(false);
  });

  it('every preset validates against the schema', () => {
    for (const preset of PRESETS) {
      const parsed = parseConfigYaml(serializeConfig(preset.config));
      expect(parsed.ok, preset.id).toBe(true);
    }
    // Observer never auto-mutates the repository.
    const observer = PRESETS.find((p) => p.id === 'observer')!.config;
    const autonomySections = [observer.issueTriage, observer.pullRequestReview, observer.documentation, observer.sourceCode];
    for (const section of autonomySections) {
      for (const value of Object.values(section)) {
        if (typeof value === 'string') expect(value).not.toBe('automatic');
      }
    }
    // Trusted still forbids source modification and merges.
    const trusted = PRESETS.find((p) => p.id === 'trusted')!.config;
    expect(trusted.sourceCode.modifySourceCode).toBe('disabled');
    expect(trusted.documentation.mergePullRequest).toBe('disabled');
    expect(trusted.safety.autoMerge).toBe(false);
  });
});
