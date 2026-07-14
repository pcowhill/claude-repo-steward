/** Minimal 16px stroke icon set (octicon-flavored geometry, original paths). */

export type IconName =
  | 'repo'
  | 'issue-open'
  | 'issue-closed'
  | 'pr'
  | 'merge'
  | 'branch'
  | 'commit'
  | 'comment'
  | 'check'
  | 'x'
  | 'dot'
  | 'gear'
  | 'shield'
  | 'steward'
  | 'play'
  | 'history'
  | 'file'
  | 'folder'
  | 'chevron-down'
  | 'chevron-right'
  | 'alert'
  | 'inbox'
  | 'pulse'
  | 'tag'
  | 'person'
  | 'eye'
  | 'book'
  | 'lock'
  | 'reset'
  | 'diff'
  | 'question';

const PATHS: Record<IconName, JSX.Element> = {
  repo: (
    <>
      <path d="M4 1.75h8.25v12.5H5.5a1.75 1.75 0 0 1-1.75-1.75V3.5A1.75 1.75 0 0 1 5.5 1.75" transform="translate(-0.5 0)" fill="none" />
      <path d="M12.25 11H5.25a1.5 1.5 0 0 0 0 3h7" fill="none" />
      <path d="M6 4.5h4" fill="none" />
    </>
  ),
  'issue-open': (
    <>
      <circle cx="8" cy="8" r="6.25" fill="none" />
      <circle cx="8" cy="8" r="1.75" fill="currentColor" stroke="none" />
    </>
  ),
  'issue-closed': (
    <>
      <circle cx="8" cy="8" r="6.25" fill="none" />
      <path d="M5.5 8.2 7.2 10l3.3-3.6" fill="none" />
    </>
  ),
  pr: (
    <>
      <circle cx="4" cy="3.5" r="1.9" fill="none" />
      <circle cx="4" cy="12.5" r="1.9" fill="none" />
      <circle cx="12" cy="12.5" r="1.9" fill="none" />
      <path d="M4 5.4v5.2" fill="none" />
      <path d="M8.5 1.8 10.6 3.6 8.5 5.4" fill="none" />
      <path d="M10.4 3.6H12v7" fill="none" />
    </>
  ),
  merge: (
    <>
      <circle cx="4" cy="3.5" r="1.9" fill="none" />
      <circle cx="4" cy="12.5" r="1.9" fill="none" />
      <circle cx="12.2" cy="8.6" r="1.9" fill="none" />
      <path d="M4 5.4v5.2" fill="none" />
      <path d="M4 6.5c0 2 2.6 2.1 6.3 2.1" fill="none" />
    </>
  ),
  branch: (
    <>
      <circle cx="4.5" cy="3.5" r="1.9" fill="none" />
      <circle cx="11.5" cy="3.5" r="1.9" fill="none" />
      <circle cx="4.5" cy="12.5" r="1.9" fill="none" />
      <path d="M4.5 5.4v5.2" fill="none" />
      <path d="M11.5 5.4c0 2.5-3 2.6-5.1 3.3" fill="none" />
    </>
  ),
  commit: (
    <>
      <circle cx="8" cy="8" r="2.6" fill="none" />
      <path d="M1.5 8h3.9M10.6 8h3.9" fill="none" />
    </>
  ),
  comment: (
    <path d="M2 3.75A1.75 1.75 0 0 1 3.75 2h8.5A1.75 1.75 0 0 1 14 3.75v6.5a1.75 1.75 0 0 1-1.75 1.75H8.5l-3.2 2.6a.4.4 0 0 1-.65-.31V12H3.75A1.75 1.75 0 0 1 2 10.25Z" fill="none" />
  ),
  check: <path d="M2.8 8.6 6.2 12 13.2 4.4" fill="none" />,
  x: <path d="M4 4l8 8M12 4l-8 8" fill="none" />,
  dot: <circle cx="8" cy="8" r="3.4" fill="currentColor" stroke="none" />,
  gear: (
    <>
      <circle cx="8" cy="8" r="2.4" fill="none" />
      <path d="M8 1.8v1.9M8 12.3v1.9M1.8 8h1.9M12.3 8h1.9M3.6 3.6 5 5M11 11l1.4 1.4M12.4 3.6 11 5M5 11l-1.4 1.4" fill="none" />
    </>
  ),
  shield: (
    <>
      <path d="M8 1.8 13.2 3.6v4.2c0 3.4-2.3 5.4-5.2 6.6-2.9-1.2-5.2-3.2-5.2-6.6V3.6Z" fill="none" />
      <path d="M5.7 8l1.6 1.7 3-3.3" fill="none" />
    </>
  ),
  steward: (
    <>
      <rect x="2.8" y="5" width="10.4" height="7.6" rx="2" fill="none" />
      <path d="M8 5V2.6M6.4 2.6h3.2" fill="none" />
      <circle cx="5.9" cy="8.4" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="10.1" cy="8.4" r="0.9" fill="currentColor" stroke="none" />
      <path d="M6 10.7h4" fill="none" />
    </>
  ),
  play: <path d="M5 3.2v9.6l8-4.8Z" fill="currentColor" stroke="none" />,
  history: (
    <>
      <path d="M2.6 8a5.4 5.4 0 1 1 1.6 3.8" fill="none" />
      <path d="M2.4 8.6 2.6 5.8 5.2 7" fill="none" />
      <path d="M8 5.2V8l2 1.6" fill="none" />
    </>
  ),
  file: (
    <>
      <path d="M4 1.8h5.2L12 4.6v9.6H4Z" fill="none" />
      <path d="M9 2v3h3" fill="none" />
    </>
  ),
  folder: <path d="M1.8 3.4h4.4l1.5 1.8h6.5v7.4H1.8Z" fill="none" />,
  'chevron-down': <path d="M4 6l4 4 4-4" fill="none" />,
  'chevron-right': <path d="M6 4l4 4-4 4" fill="none" />,
  alert: (
    <>
      <path d="M8 2 14.6 13.4H1.4Z" fill="none" />
      <path d="M8 6.4v3.4" fill="none" />
      <circle cx="8" cy="11.7" r="0.8" fill="currentColor" stroke="none" />
    </>
  ),
  inbox: (
    <>
      <path d="M2 9.4 4 3.4h8l2 6" fill="none" />
      <path d="M2 9.4h3.4c0 1.2 1.1 2.2 2.6 2.2s2.6-1 2.6-2.2H14v3.8H2Z" fill="none" />
    </>
  ),
  pulse: <path d="M1.8 8h2.8l1.8-4.4 3 8.8L11.2 8H14.2" fill="none" />,
  tag: (
    <>
      <path d="M2 2h5.4L14 8.6 8.6 14 2 7.4Z" fill="none" />
      <circle cx="5.3" cy="5.3" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  person: (
    <>
      <circle cx="8" cy="5" r="2.6" fill="none" />
      <path d="M2.8 13.6c0-2.6 2.3-4.2 5.2-4.2s5.2 1.6 5.2 4.2" fill="none" />
    </>
  ),
  eye: (
    <>
      <path d="M1.6 8C3 5 5.3 3.4 8 3.4S13 5 14.4 8C13 11 10.7 12.6 8 12.6S3 11 1.6 8Z" fill="none" />
      <circle cx="8" cy="8" r="1.9" fill="none" />
    </>
  ),
  book: (
    <>
      <path d="M8 3.2C6.7 2.3 4.8 2 2 2v11c2.8 0 4.7.3 6 1.2 1.3-.9 3.2-1.2 6-1.2V2c-2.8 0-4.7.3-6 1.2Z" fill="none" />
      <path d="M8 3.2v11" fill="none" />
    </>
  ),
  lock: (
    <>
      <rect x="3.4" y="7" width="9.2" height="6.6" rx="1.4" fill="none" />
      <path d="M5.4 7V5a2.6 2.6 0 0 1 5.2 0v2" fill="none" />
    </>
  ),
  reset: (
    <>
      <path d="M13.4 8A5.4 5.4 0 1 1 11.8 4.2" fill="none" />
      <path d="M13.6 1.8v3l-3-.4" fill="none" />
    </>
  ),
  diff: (
    <>
      <path d="M8 1.8v12.4" fill="none" />
      <path d="M5 4.6H2v6.8h3M11 4.6h3v6.8h-3" fill="none" />
    </>
  ),
  question: (
    <>
      <circle cx="8" cy="8" r="6.2" fill="none" />
      <path d="M6.2 6.2c0-1 .8-1.8 1.8-1.8s1.8.7 1.8 1.7c0 1.4-1.8 1.5-1.8 2.9" fill="none" />
      <circle cx="8" cy="11.4" r="0.8" fill="currentColor" stroke="none" />
    </>
  ),
};

export function Icon({
  name,
  size = 16,
  className,
  title,
}: {
  name: IconName;
  size?: number;
  className?: string;
  title?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
      className={className}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title ? <title>{title}</title> : null}
      {PATHS[name]}
    </svg>
  );
}
