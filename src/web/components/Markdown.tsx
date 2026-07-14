import { Fragment, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

/**
 * Small GitHub-flavored markdown renderer for the fixture/steward content we
 * generate: headings, lists (incl. task lists), fenced code, inline code,
 * bold/italic, links, blockquotes, tables, hr, and #42-style references.
 * Renders to React nodes — never raw HTML — so repository content stays data.
 */

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  // Tokenize: code spans first, then bold, italics, links, issue refs.
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\n]+\*)|(\[[^\]]+\]\([^)]+\))|((?:^|\s)#\d+\b)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let k = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const token = match[0];
    const key = `${keyBase}-${k++}`;
    if (token.startsWith('`')) {
      out.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith('**')) {
      out.push(<strong key={key}>{inline(token.slice(2, -2), key)}</strong>);
    } else if (token.startsWith('*')) {
      out.push(<em key={key}>{inline(token.slice(1, -1), key)}</em>);
    } else if (token.startsWith('[')) {
      const m = /\[([^\]]+)\]\(([^)]+)\)/.exec(token);
      if (m) {
        out.push(
          <a key={key} href={m[2]} target="_blank" rel="noreferrer">
            {m[1]}
          </a>,
        );
      }
    } else {
      const numMatch = /#(\d+)/.exec(token);
      if (numMatch) {
        const leading = token.slice(0, token.indexOf('#'));
        if (leading) out.push(leading);
        out.push(
          <RefLink key={key} number={Number(numMatch[1])} />,
        );
      }
    }
    last = match.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** #N — the UI resolves whether it's an issue or PR at click time. */
function RefLink({ number }: { number: number }) {
  return <Link to={`/ref/${number}`}>#{number}</Link>;
}

export function Markdown({ text }: { text: string }) {
  const lines = text.split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let k = 0;

  while (i < lines.length) {
    const line = lines[i];
    const key = `b${k++}`;

    if (line.startsWith('```')) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) buf.push(lines[i++]);
      i++; // closing fence
      blocks.push(
        <pre key={key}>
          <code>{buf.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const content = inline(heading[2], key);
      blocks.push(
        level === 1 ? <h1 key={key}>{content}</h1>
        : level === 2 ? <h2 key={key}>{content}</h2>
        : level === 3 ? <h3 key={key}>{content}</h3>
        : <h4 key={key}>{content}</h4>,
      );
      i++;
      continue;
    }

    if (/^(-{3,}|\*{3,})\s*$/.test(line)) {
      blocks.push(<hr key={key} />);
      i++;
      continue;
    }

    if (line.startsWith('>')) {
      const buf: string[] = [];
      while (i < lines.length && lines[i].startsWith('>')) buf.push(lines[i++].replace(/^>\s?/, ''));
      blocks.push(
        <blockquote key={key}>
          <Markdown text={buf.join('\n')} />
        </blockquote>,
      );
      continue;
    }

    // Tables: header | --- | rows
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const parseRow = (row: string) =>
        row
          .replace(/^\s*\|/, '')
          .replace(/\|\s*$/, '')
          .split('|')
          .map((c) => c.trim());
      const header = parseRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        rows.push(parseRow(lines[i++]));
      }
      blocks.push(
        <table key={key}>
          <thead>
            <tr>
              {header.map((h, hi) => (
                <th key={hi}>{inline(h, `${key}h${hi}`)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri}>
                {r.map((c, ci) => (
                  <td key={ci}>{inline(c, `${key}r${ri}c${ci}`)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>,
      );
      continue;
    }

    const listMatch = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(line);
    if (listMatch) {
      const ordered = /\d+\./.test(listMatch[2]);
      const items: string[] = [];
      while (i < lines.length) {
        const m = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(lines[i]);
        if (!m) {
          // continuation lines indented under the current item
          if (lines[i].startsWith('   ') && items.length > 0 && lines[i].trim() !== '') {
            items[items.length - 1] += ` ${lines[i].trim()}`;
            i++;
            continue;
          }
          break;
        }
        items.push(m[3]);
        i++;
      }
      const rendered = items.map((item, ii) => {
        const task = /^\[( |x)\]\s+(.*)$/.exec(item);
        if (task) {
          return (
            <li key={ii} className="task">
              <input type="checkbox" checked={task[1] === 'x'} readOnly aria-label={task[2]} /> {inline(task[2], `${key}i${ii}`)}
            </li>
          );
        }
        return <li key={ii}>{inline(item, `${key}i${ii}`)}</li>;
      });
      blocks.push(ordered ? <ol key={key}>{rendered}</ol> : <ul key={key}>{rendered}</ul>);
      continue;
    }

    if (line.trim() === '') {
      i++;
      continue;
    }

    // Paragraph: gather until blank line or a structural line.
    const buf: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^(#{1,4})\s/.test(lines[i]) &&
      !lines[i].startsWith('```') &&
      !lines[i].startsWith('>') &&
      !/^(\s*)([-*]|\d+\.)\s+/.test(lines[i])
    ) {
      buf.push(lines[i++]);
    }
    blocks.push(
      <p key={key}>
        {buf.map((b, bi) => (
          <Fragment key={bi}>
            {bi > 0 ? ' ' : null}
            {inline(b, `${key}p${bi}`)}
          </Fragment>
        ))}
      </p>,
    );
  }

  return <div className="md">{blocks}</div>;
}
