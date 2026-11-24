import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function Modal({
  title,
  description,
  children,
  onCancel,
  confirmation = false,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  onCancel(): void;
  confirmation?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const element = ref.current!;
    const previous = document.activeElement;
    element.showModal();
    return () => {
      element.close();
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, []);
  return createPortal(
    <dialog
      ref={ref}
      role={confirmation ? 'alertdialog' : 'dialog'}
      aria-labelledby={`${id}-title`}
      aria-describedby={description ? `${id}-description` : undefined}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        const controls = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((element) => element.getClientRects().length > 0);
        const first = controls[0],
          last = controls.at(-1);
        if (
          !first ||
          (event.shiftKey
            ? document.activeElement === first
            : document.activeElement === last)
        ) {
          event.preventDefault();
          (event.shiftKey ? last : first)?.focus();
        }
      }}
      className={`no-drag fixed m-auto max-h-[90vh] max-w-[calc(100vw-32px)] overflow-y-auto rounded-card border-0 bg-surface p-6 text-body text-ink shadow-2 ring-[0.5px] ring-line backdrop:bg-black/20 ${confirmation ? 'w-[420px]' : 'w-[500px]'}`}
    >
      <h2
        id={`${id}-title`}
        className={`m-0 text-title font-semibold ${description ? 'mb-2' : 'mb-3'}`}
      >
        {title}
      </h2>
      {description && (
        <p id={`${id}-description`} className="m-0 text-ink-2">
          {description}
        </p>
      )}
      {children}
    </dialog>,
    document.body,
  );
}
