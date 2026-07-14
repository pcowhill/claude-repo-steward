import { useMemo, type ReactNode } from 'react';

/** Line-numbered code viewer with lightweight, safe tokenizing for TS/JSON/
 * YAML/Markdown readability. Tokenizing is per-line and regex based — good
 * enough to make fixtures readable, deliberately not a real parser. */

const TS_KEYWORDS =
  /\b(import|export|from|const|let|var|function|return|if|else|for|while|switch|case|break|continue|new|type|interface|extends|implements|class|public|private|readonly|async|await|typeof|keyof|in|of|null|undefined|true|false|void|this|default|throw|try|catch|finally|enum|as|satisfies)\b/;

function tokenizeLine(line: string, lang: string, inBlockComment: boolean): { nodes: ReactNode[]; inBlockComment: boolean } {
  const nodes: ReactNode[] = [];
  if (lang === 'md') {
    if (/^#{1,6}\s/.test(line)) return { nodes: [<span key="h" className="tok-md-h">{line}</span>], inBlockComment: false };
    return { nodes: [line], inBlockComment: false };
  }
  let rest = line;
  let key = 0;
  let inside = inBlockComment;

  while (rest.length > 0) {
    if (inside) {
      const end = rest.indexOf('*/');
      if (end === -1) {
        nodes.push(<span key={key++} className="tok-com">{rest}</span>);
        return { nodes, inBlockComment: true };
      }
      nodes.push(<span key={key++} className="tok-com">{rest.slice(0, end + 2)}</span>);
      rest = rest.slice(end + 2);
      inside = false;
      continue;
    }
    const patterns: Array<{ re: RegExp; cls: string | null }> = [
      { re: /^\/\/.*$/, cls: 'tok-com' },
      { re: /^#.*$/, cls: lang === 'yaml' ? 'tok-com' : null },
      { re: /^\/\*/, cls: 'BLOCK' },
      { re: /^(['"`])(?:\\.|(?!\1).)*\1/, cls: 'tok-str' },
      { re: /^\b\d+(\.\d+)?\b/, cls: 'tok-num' },
      { re: TS_KEYWORDS, cls: 'tok-kw' },
    ];
    let matched = false;
    for (const { re, cls } of patterns) {
      if (cls === null) continue;
      const m = re.exec(rest);
      if (m && m.index === 0) {
        if (cls === 'BLOCK') {
          inside = true;
          matched = true;
          break;
        }
        nodes.push(
          <span key={key++} className={cls}>
            {m[0]}
          </span>,
        );
        rest = rest.slice(m[0].length);
        matched = true;
        break;
      }
    }
    if (inside) continue;
    if (!matched) {
      // Advance to the next interesting boundary.
      const next = rest.slice(1).search(/["'`/#\d]|\b(import|export|const|let|function|return|if|else|type|interface|class|await|async)\b/);
      const take = next === -1 ? rest.length : next + 1;
      nodes.push(rest.slice(0, take));
      rest = rest.slice(take);
    }
  }
  return { nodes, inBlockComment: inside };
}

export function languageOf(path: string): string {
  if (/\.(ts|tsx|js|jsx)$/.test(path)) return 'ts';
  if (/\.(json)$/.test(path)) return 'json';
  if (/\.(ya?ml)$/.test(path)) return 'yaml';
  if (/\.md$/.test(path)) return 'md';
  return 'text';
}

export function CodeView({ content, path }: { content: string; path: string }) {
  const lang = languageOf(path);
  const rows = useMemo(() => {
    const lines = content.replace(/\n$/, '').split('\n');
    let block = false;
    return lines.map((line) => {
      const { nodes, inBlockComment } = tokenizeLine(line, lang, block);
      block = inBlockComment;
      return nodes;
    });
  }, [content, lang]);

  return (
    <div className="code-view">
      <table>
        <tbody>
          {rows.map((nodes, i) => (
            <tr key={i} id={`L${i + 1}`}>
              <td className="ln">{i + 1}</td>
              <td className="lc">{nodes.length > 0 ? nodes : ' '}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
