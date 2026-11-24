import { useId, useRef, type CSSProperties, type ReactNode } from 'react';

// A button that opens a native light-dismiss popover anchored to it. Clicking
// any button inside closes it, unless `keepOpen` is set.
export function Popover({
  label,
  title,
  buttonClass,
  area = 'bottom span-right',
  className = '',
  onToggle,
  children,
}: {
  label: ReactNode;
  title?: string;
  buttonClass: string;
  area?: string;
  className?: string;
  onToggle?: (open: boolean) => void;
  children: ReactNode;
}) {
  const id = `pop${useId().replaceAll(':', '')}`;
  const ref = useRef<HTMLDivElement>(null);
  return (
    <>
      <button
        type="button"
        title={title}
        popoverTarget={id}
        style={{ anchorName: `--${id}` } as CSSProperties}
        className={`no-drag ${buttonClass}`}
      >
        {label}
      </button>
      <div
        id={id}
        ref={ref}
        popover="auto"
        onToggle={
          onToggle ? (event) => onToggle(event.newState === 'open') : undefined
        }
        style={
          {
            positionAnchor: `--${id}`,
            positionArea: area,
            positionTryFallbacks: 'flip-block, flip-inline',
          } as CSSProperties
        }
        className={`no-drag fixed m-0 my-1 flex-col [&:popover-open]:flex rounded-card border-0 bg-surface p-1.5 text-ink shadow-2 ring-[0.5px] ring-line ${className}`}
        onClick={(e) => {
          if ((e.target as Element).closest('button'))
            ref.current?.hidePopover();
        }}
      >
        {children}
      </div>
    </>
  );
}

export const menuRow =
  'flex h-8 w-full min-w-0 items-center gap-2 rounded-item px-2 text-left hover:bg-hover focus-visible:bg-hover outline-none';
export const menuGroup = 'px-2 pt-1.5 pb-0.5 text-[11px] text-ink-3';
