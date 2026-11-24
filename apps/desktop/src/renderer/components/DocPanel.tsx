import type { ReactNode, Ref } from 'react';
import { IconButton } from './Icon';

// The document panel beside the chat (DESIGN.md Layout): ~540px, a hairline on
// the left, its own 52px header bar, expandable to full width. It slides in
// from the right (180ms); reduced motion makes it instant. `fill` lets the body
// stretch to the panel height (editors); `wide` drops the 760px reading column
// when expanded; `footer` stays pinned under the scrolling body.
export function DocPanel({
  label,
  header,
  actions,
  expanded,
  onExpand,
  onClose,
  children,
  footer,
  fill = false,
  wide = false,
  ref,
}: {
  label: string;
  header: ReactNode;
  actions?: ReactNode;
  expanded: boolean;
  onExpand: () => void;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  fill?: boolean;
  wide?: boolean;
  ref?: Ref<HTMLDivElement>;
}) {
  return (
    <aside
      aria-label={label}
      // ⌘F find scope (components/FindBar.tsx); only Case and Playbook use DocPanel.
      data-find-scope={label.startsWith('Playbook') ? 'Playbook' : 'case'}
      className={`slide-in-right relative flex min-w-0 flex-col border-l border-line bg-surface ${expanded ? 'flex-1' : 'w-[540px] flex-none max-[1279px]:absolute max-[1279px]:inset-0 max-[1279px]:z-10 max-[1279px]:w-auto'}`}
    >
      <div className="drag flex h-[52px] flex-none items-center gap-2 pr-2.5 pl-[18px]">
        {/* Header items clip here so the badge and buttons never leave the 540px panel. */}
        <div className="flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap">
          {header}
        </div>
        <span className="flex-1" />
        {actions}
        <IconButton
          name="expand"
          label={expanded ? 'Back to side panel' : 'Expand to full width'}
          onClick={onExpand}
        />
        <IconButton name="close" label="Close" onClick={onClose} />
      </div>
      <div
        ref={ref}
        className={`min-h-0 flex-1 overflow-y-auto select-text ${fill ? 'flex flex-col' : ''}`}
      >
        <div
          className={`px-7 pt-1 pb-8 ${expanded && !wide ? 'mx-auto w-full max-w-[760px]' : ''} ${fill ? 'flex flex-1 flex-col pb-0' : ''}`}
        >
          {children}
        </div>
      </div>
      {footer && <div className="flex-none border-t border-line">{footer}</div>}
    </aside>
  );
}

// A numbered document section heading.
export function DocSection({
  id,
  n,
  title,
  children,
}: {
  id?: string;
  n?: number;
  title: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-4 pt-3.5 pb-1">
      <h2 className="m-0 mb-1.5 flex items-center gap-2 text-body font-semibold">
        {n !== undefined && (
          <span className="w-3 text-[11px] font-medium text-ink-3">{n}</span>
        )}
        {title}
      </h2>
      {children}
    </section>
  );
}
