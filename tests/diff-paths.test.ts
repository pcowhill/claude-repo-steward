import { describe, expect, it } from 'vitest';
import { diffFile, diffLines, diffTrees, patchStats, toHunks } from '../src/core/diff';
import { checkDocPath, matchesGlob } from '../src/core/paths';

describe('line diff', () => {
  it('computes adds, deletes and context with correct numbering', () => {
    const before = 'a\nb\nc\nd\n';
    const after = 'a\nB\nc\nd\ne\n';
    const lines = diffLines(before, after);
    expect(lines.filter((l) => l.type === 'add').map((l) => l.text)).toEqual(['B', 'e']);
    expect(lines.filter((l) => l.type === 'del').map((l) => l.text)).toEqual(['b']);
    const added = lines.find((l) => l.text === 'e')!;
    expect(added.newNo).toBe(5);
    expect(added.oldNo).toBeNull();
  });

  it('groups changes into hunks with headers', () => {
    const before = Array.from({ length: 40 }, (_, i) => `line${i}`).join('\n');
    const after = before.replace('line5', 'LINE5').replace('line30', 'LINE30');
    const hunks = toHunks(diffLines(before, after));
    expect(hunks).toHaveLength(2);
    expect(hunks[0].header).toMatch(/^@@ -\d+,\d+ \+\d+,\d+ @@$/);
  });

  it('diffTrees reports added/deleted/modified files and patchStats totals', () => {
    const diffs = diffTrees(
      { 'a.md': 'one\n', 'b.md': 'keep\n', 'c.md': 'bye\n' },
      { 'a.md': 'one\ntwo\n', 'b.md': 'keep\n', 'd.md': 'new\n' },
    );
    const byPath = Object.fromEntries(diffs.map((d) => [d.path, d.status]));
    expect(byPath).toEqual({ 'a.md': 'modified', 'c.md': 'deleted', 'd.md': 'added' });
    const stats = patchStats(diffs);
    expect(stats.filesChanged).toBe(3);
    expect(stats.additions).toBe(2);
    expect(stats.deletions).toBe(1);
    expect(stats.linesChanged).toBe(3);
  });

  it('identical content produces no hunks', () => {
    expect(diffFile('x.md', 'same\n', 'same\n').hunks).toHaveLength(0);
  });
});

describe('path globs', () => {
  it('matches ** across segments and * within one', () => {
    expect(matchesGlob('docs/status-semantics.md', 'docs/**')).toBe(true);
    expect(matchesGlob('docs/deep/nested.md', 'docs/**')).toBe(true);
    expect(matchesGlob('src/state/readinessStore.ts', 'src/**')).toBe(true);
    expect(matchesGlob('README.md', 'README.md')).toBe(true);
    expect(matchesGlob('docs/a.md', '*.md')).toBe(false);
    expect(matchesGlob('a.md', '*.md')).toBe(true);
    expect(matchesGlob('.github/workflows/ci.yml', '.github/workflows/**')).toBe(true);
  });

  it('forbidden paths win over editable paths', () => {
    const editable = ['README.md', 'docs/**'];
    const forbidden = ['src/**', 'docs/internal/**'];
    expect(checkDocPath('docs/guide.md', editable, forbidden).allowed).toBe(true);
    expect(checkDocPath('docs/internal/secrets.md', editable, forbidden).allowed).toBe(false);
    expect(checkDocPath('src/app.ts', editable, forbidden).allowed).toBe(false);
    expect(checkDocPath('elsewhere.txt', editable, forbidden)).toMatchObject({ allowed: false, rule: 'matches no editable path' });
  });
});
