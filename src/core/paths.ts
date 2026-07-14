/**
 * Minimal glob matching for policy path rules.
 *
 * Supported syntax (the subset `.repo-steward.yml` uses):
 *   `**`  matches any number of path segments (including none)
 *   `*`   matches within a single segment
 *   everything else matches literally
 */

const regexCache = new Map<string, RegExp>();

export function globToRegExp(glob: string): RegExp {
  const cached = regexCache.get(glob);
  if (cached) return cached;
  let out = '^';
  let i = 0;
  while (i < glob.length) {
    const ch = glob[i];
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        // `**/` or trailing `**` — match across segments.
        if (glob[i + 2] === '/') {
          out += '(?:[^/]+/)*';
          i += 3;
        } else {
          out += '.*';
          i += 2;
        }
      } else {
        out += '[^/]*';
        i += 1;
      }
    } else if ('\\^$.|?+()[]{}'.includes(ch)) {
      out += `\\${ch}`;
      i += 1;
    } else {
      out += ch;
      i += 1;
    }
  }
  out += '$';
  const re = new RegExp(out);
  regexCache.set(glob, re);
  return re;
}

export function matchesGlob(path: string, glob: string): boolean {
  // `docs/**` conventionally also matches everything under docs/.
  if (glob.endsWith('/**') && path.startsWith(glob.slice(0, -2))) return true;
  return globToRegExp(glob).test(path);
}

export function matchesAny(path: string, globs: string[]): string | null {
  for (const glob of globs) {
    if (matchesGlob(path, glob)) return glob;
  }
  return null;
}

export interface PathCheck {
  path: string;
  allowed: boolean;
  rule: string;
}

/** Check one path against the documentation allow/deny lists. Deny wins. */
export function checkDocPath(
  path: string,
  editablePaths: string[],
  forbiddenPaths: string[],
): PathCheck {
  const forbidden = matchesAny(path, forbiddenPaths);
  if (forbidden) {
    return { path, allowed: false, rule: `matches forbidden path "${forbidden}"` };
  }
  const editable = matchesAny(path, editablePaths);
  if (!editable) {
    return { path, allowed: false, rule: 'matches no editable path' };
  }
  return { path, allowed: true, rule: `allowed by editable path "${editable}"` };
}
