import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { SimLabel, SimUser } from '../../sim/types';
import { initialsOf } from '../format';
import { Icon } from './Icon';

export function LabelPill({ label }: { label: SimLabel | undefined }) {
  if (!label) return null;
  const r = parseInt(label.color.slice(0, 2), 16);
  const g = parseInt(label.color.slice(2, 4), 16);
  const b = parseInt(label.color.slice(4, 6), 16);
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  const dark = brightness < 150;
  return (
    <span
      className="label-pill"
      title={label.description}
      style={{
        backgroundColor: `#${label.color}`,
        color: dark ? '#fff' : '#1f2328',
        borderColor: dark ? 'transparent' : 'rgba(31,35,40,0.15)',
      }}
    >
      {label.name}
    </span>
  );
}

export function Avatar({ user, size }: { user: SimUser | undefined; size?: 'lg' }) {
  if (!user) return null;
  return (
    <span
      className={`avatar ${size ?? ''}`}
      style={{ background: user.color }}
      title={`${user.name} (@${user.login})`}
    >
      {user.kind === 'bot' ? <Icon name="steward" size={size === 'lg' ? 16 : 12} /> : initialsOf(user.name)}
    </span>
  );
}

export function UserChip({ user, showBadge = true }: { user: SimUser | undefined; showBadge?: boolean }) {
  if (!user) return null;
  return (
    <span className="user-chip">
      <Avatar user={user} />
      {user.login}
      {showBadge && user.kind === 'bot' ? <span className="mini-badge bot">bot</span> : null}
    </span>
  );
}

export function ConfidenceMeter({ value }: { value: number }) {
  return (
    <span className={`confidence-meter ${value < 0.82 ? 'low' : ''}`} title={`Analyzer confidence ${value.toFixed(2)}`}>
      <span className="bar">
        <span style={{ width: `${Math.round(value * 100)}%` }} />
      </span>
      {value.toFixed(2)}
    </span>
  );
}

export function Dropdown({
  button,
  children,
  align = 'right',
  width,
}: {
  button: (open: boolean) => ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  align?: 'left' | 'right';
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div className="dropdown-holder" ref={ref}>
      <span onClick={() => setOpen((o) => !o)}>{button(open)}</span>
      {open ? (
        <div className="dropdown-panel" style={{ [align === 'left' ? 'left' : 'right']: 0, width }} role="menu">
          {typeof children === 'function' ? children(() => setOpen(false)) : children}
        </div>
      ) : null}
    </div>
  );
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title}>
        <header>
          {title}
          <button className="btn btn-sm btn-invisible" onClick={onCancel} aria-label="Close dialog">
            <Icon name="x" />
          </button>
        </header>
        <div className="dialog-body">{body}</div>
        <footer>
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm} autoFocus>
            {confirmLabel}
          </button>
        </footer>
      </div>
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: Array<{ value: T; label: string; title?: string }>;
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <span className="segmented" role="radiogroup" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          role="radio"
          aria-checked={value === option.value}
          className={value === option.value ? 'on' : ''}
          title={option.title}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </span>
  );
}

export function EmptyState({ icon, title, children }: { icon: Parameters<typeof Icon>[0]['name']; title: string; children?: ReactNode }) {
  return (
    <div className="empty-state">
      <Icon name={icon} size={28} />
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}

/** Inline glossary for policy vocabulary. */
export function Term({ word, children }: { word: string; children: ReactNode }) {
  const GLOSSARY: Record<string, string> = {
    automatic: 'Executes immediately when confidence and safety checks pass — no human in the loop.',
    propose: 'Enters the Steward Inbox and waits for a human to approve or reject it.',
    disabled: 'May never execute. Proposals for this action are recorded as blocked.',
    downgraded: 'Configured automatic, but confidence fell below the automatic threshold, so it became a proposal instead.',
    confidence: 'The analyzer’s own 0–1 estimate of how well-supported this proposal is. Thresholds live in analysis.* of .repo-steward.yml.',
  };
  return (
    <span className="tooltip-term" title={GLOSSARY[word] ?? word}>
      {children}
    </span>
  );
}
