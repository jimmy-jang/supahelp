import type { ReactNode } from 'react';

const kinds = {
  primary: 'bg-ink text-on-ink',
  secondary: 'bg-surface text-ink shadow-1',
  ghost: 'text-ink-2 hover:bg-hover',
  danger: 'bg-bad-soft text-bad',
};

export function Button({
  kind = 'primary',
  children,
  onClick,
  disabled = false,
  autoFocus = false,
  type = 'button',
  'aria-expanded': expanded,
  'aria-label': label,
}: {
  kind?: keyof typeof kinds;
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  autoFocus?: boolean;
  type?: 'button' | 'submit';
  'aria-expanded'?: boolean;
  'aria-label'?: string;
}) {
  return (
    <button
      type={type}
      aria-expanded={expanded}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      autoFocus={autoFocus}
      className={`no-drag inline-flex items-center gap-1.5 rounded-item px-3 py-1.5 text-[12.5px] font-medium whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-45 ${kinds[kind]}`}
    >
      {children}
    </button>
  );
}
