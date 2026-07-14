/**
 * Line-based diffing for the simulator: PR "Files changed" views, docs-patch
 * previews, and the policy engine's changed-line accounting all use this.
 * Classic LCS dynamic programming — fine for the file sizes involved.
 */

export interface DiffLine {
  type: 'context' | 'add' | 'del';
  oldNo: number | null;
  newNo: number | null;
  text: string;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface FileDiff {
  path: string;
  status: 'added' | 'deleted' | 'modified';
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
}

function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  const n = a.length;
  const m = b.length;

  // Trim common prefix/suffix so the DP table stays small.
  let start = 0;
  while (start < n && start < m && a[start] === b[start]) start++;
  let endA = n;
  let endB = m;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const la = midA.length;
  const lb = midB.length;

  // LCS table over the trimmed middle.
  const dp: Uint32Array[] = [];
  for (let i = 0; i <= la; i++) dp.push(new Uint32Array(lb + 1));
  for (let i = la - 1; i >= 0; i--) {
    for (let j = lb - 1; j >= 0; j--) {
      dp[i][j] = midA[i] === midB[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const out: DiffLine[] = [];
  let oldNo = 1;
  let newNo = 1;
  const pushContext = (text: string) => out.push({ type: 'context', oldNo: oldNo++, newNo: newNo++, text });
  const pushDel = (text: string) => out.push({ type: 'del', oldNo: oldNo++, newNo: null, text });
  const pushAdd = (text: string) => out.push({ type: 'add', oldNo: null, newNo: newNo++, text });

  for (let k = 0; k < start; k++) pushContext(a[k]);
  let i = 0;
  let j = 0;
  while (i < la && j < lb) {
    if (midA[i] === midB[j]) {
      pushContext(midA[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      pushDel(midA[i]);
      i++;
    } else {
      pushAdd(midB[j]);
      j++;
    }
  }
  while (i < la) pushDel(midA[i++]);
  while (j < lb) pushAdd(midB[j++]);
  for (let k = endA; k < n; k++) pushContext(a[k]);
  return out;
}

/** Group a full line diff into hunks with `context` lines of surround. */
export function toHunks(lines: DiffLine[], context = 3): DiffHunk[] {
  const changed = lines.map((l) => l.type !== 'context');
  if (!changed.some(Boolean)) return [];

  const keep = new Array<boolean>(lines.length).fill(false);
  for (let i = 0; i < lines.length; i++) {
    if (!changed[i]) continue;
    for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++) {
      keep[k] = true;
    }
  }

  const hunks: DiffHunk[] = [];
  let current: DiffLine[] = [];
  const flush = () => {
    if (current.length === 0) return;
    const oldStart = current.find((l) => l.oldNo !== null)?.oldNo ?? 0;
    const newStart = current.find((l) => l.newNo !== null)?.newNo ?? 0;
    const oldCount = current.filter((l) => l.oldNo !== null).length;
    const newCount = current.filter((l) => l.newNo !== null).length;
    hunks.push({
      header: `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`,
      lines: current,
    });
    current = [];
  };
  for (let i = 0; i < lines.length; i++) {
    if (keep[i]) current.push(lines[i]);
    else flush();
  }
  flush();
  return hunks;
}

export function diffFile(
  path: string,
  oldContent: string | null,
  newContent: string | null,
): FileDiff {
  const status: FileDiff['status'] =
    oldContent === null ? 'added' : newContent === null ? 'deleted' : 'modified';
  const lines = diffLines(oldContent ?? '', newContent ?? '');
  return {
    path,
    status,
    additions: lines.filter((l) => l.type === 'add').length,
    deletions: lines.filter((l) => l.type === 'del').length,
    hunks: toHunks(lines),
  };
}

/** Diff two trees (path → content). Returns only files that differ. */
export function diffTrees(
  oldFiles: Record<string, string>,
  newFiles: Record<string, string>,
): FileDiff[] {
  const paths = Array.from(new Set([...Object.keys(oldFiles), ...Object.keys(newFiles)])).sort();
  const diffs: FileDiff[] = [];
  for (const path of paths) {
    const before = path in oldFiles ? oldFiles[path] : null;
    const after = path in newFiles ? newFiles[path] : null;
    if (before === after) continue;
    diffs.push(diffFile(path, before, after));
  }
  return diffs;
}

export interface PatchStats {
  filesChanged: number;
  linesChanged: number;
  additions: number;
  deletions: number;
}

export function patchStats(diffs: FileDiff[]): PatchStats {
  let additions = 0;
  let deletions = 0;
  for (const d of diffs) {
    additions += d.additions;
    deletions += d.deletions;
  }
  return { filesChanged: diffs.length, linesChanged: additions + deletions, additions, deletions };
}
