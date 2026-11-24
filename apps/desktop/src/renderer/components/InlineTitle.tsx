import { useEffect, useId, useRef, useState } from 'react';
import { checkedTitle } from '../../contracts/titles';
import { Icon } from './Icon';

export function InlineTitle({
  value,
  label,
  disabled,
  onSave,
  onDraftChange,
  onClose,
}: {
  value: string;
  label: string;
  disabled?: boolean;
  onSave(title: string, expectedTitle: string): Promise<string>;
  onDraftChange?(title: string | undefined): void;
  onClose?(): void;
}) {
  const [edit, setEdit] = useState(
    onClose ? { title: value, before: value } : undefined,
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const errorId = useId();
  const changed = !!edit && edit.title !== edit.before;
  const conflict = !!edit && value !== edit.before;
  const editing = !!edit;
  useEffect(() => {
    if (editing) {
      input.current?.focus();
      input.current?.select();
    }
  }, [editing]);
  useEffect(() => {
    onDraftChange?.(edit?.title);
  }, [edit?.title, onDraftChange]);
  useEffect(() => {
    if (!changed && !busy) return;
    const prevent = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', prevent);
    return () => window.removeEventListener('beforeunload', prevent);
  }, [changed, busy]);
  const close = () => {
    setEdit(undefined);
    setError('');
    onClose?.();
    requestAnimationFrame(() => button.current?.focus());
  };
  const save = async () => {
    if (!edit || pending.current || disabled || conflict) return;
    let title: string;
    try {
      title = checkedTitle(edit.title);
    } catch {
      setError('Use a title between 1 and 120 characters on one line.');
      return;
    }
    if (title === edit.before) {
      close();
      return;
    }
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await onSave(title, edit.before);
      close();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'The title could not be saved. Try again.',
      );
      requestAnimationFrame(() => input.current?.focus());
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <span className="no-drag inline-flex min-w-0 max-w-full flex-wrap items-center gap-1.5 align-middle">
      {edit ? (
        <>
          <input
            ref={input}
            aria-label={label}
            aria-invalid={!!error || conflict}
            aria-describedby={error || conflict ? errorId : undefined}
            className="min-w-0 flex-1 rounded-item border border-line bg-surface px-2 py-1 text-inherit text-ink focus-visible:outline-2 focus-visible:outline-busy"
            maxLength={120}
            value={edit.title}
            disabled={busy || disabled}
            onChange={(event) => {
              setEdit({ ...edit, title: event.target.value });
              setError('');
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === 'Enter') {
                event.preventDefault();
                event.stopPropagation();
                void save();
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                if (!pending.current) close();
              }
            }}
          />
          <button
            type="button"
            aria-label={`Save ${label.toLowerCase()}`}
            disabled={busy || disabled || conflict || !edit.title.trim()}
            className="rounded-item px-2 py-1 text-meta font-medium hover:bg-hover disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-busy"
            onClick={() => void save()}
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            aria-label={`Cancel ${label.toLowerCase()} edit`}
            disabled={busy}
            className="rounded-item px-2 py-1 text-meta font-normal text-ink-2 hover:bg-hover disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-busy"
            onClick={close}
          >
            Cancel
          </button>
          {(error || conflict) && (
            <span
              id={errorId}
              role="alert"
              className="w-full text-meta font-normal text-bad"
            >
              {conflict
                ? 'This title changed. Your text is kept. Cancel to load the current title.'
                : error}
            </span>
          )}
        </>
      ) : (
        <button
          ref={button}
          type="button"
          aria-label={`Rename ${label.toLowerCase()}`}
          title={value}
          disabled={disabled}
          className="group inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-item text-left hover:bg-hover focus-visible:outline-2 focus-visible:outline-busy"
          onClick={() => setEdit({ title: value, before: value })}
        >
          <span className="truncate">{value}</span>
          <span className="shrink-0 text-ink-3 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100">
            <Icon name="edit" size={13} />
          </span>
        </button>
      )}
    </span>
  );
}
