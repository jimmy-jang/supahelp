import { useEffect, useRef, useState } from 'react';
import type { CaseEntry } from '../../../contracts/cases';
import { Button } from '../../components/Button';
import { useConfirmation } from '../../components/ConfirmationProvider';
import { Modal } from '../../components/Modal';
import type { useCollaboration } from './useCollaboration';
export function QuestionControls({
  caseId,
  entry,
  collaboration,
}: {
  caseId: string;
  entry: CaseEntry;
  collaboration: ReturnType<typeof useCollaboration>;
}) {
  const c = collaboration,
    [text, setText] = useState(''),
    request = useRef(crypto.randomUUID());
  const [answering, setAnswering] = useState(false);
  const confirm = useConfirmation(),
    closing = useRef(false);
  const close = async () => {
    if (c.busy || closing.current) return;
    closing.current = true;
    try {
      if (
        !text ||
        (await confirm({
          title: 'Discard unsaved answer?',
          description: 'Your unsaved answer will be lost.',
          action: 'Discard answer',
          cancel: 'Keep editing',
          danger: true,
        }))
      ) {
        setAnswering(false);
        setText('');
      }
    } finally {
      closing.current = false;
    }
  };
  useEffect(() => {
    if (!answering || (!text && !c.busy)) return;
    const prevent = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', prevent);
    return () => window.removeEventListener('beforeunload', prevent);
  }, [answering, text, c.busy]);
  const pending =
    c.value?.candidates.filter(
      (a) => a.documentId === caseId && a.entryId === entry.id,
    ) ?? [];
  return (
    <div className="mt-2 space-y-2 text-meta">
      <p className="m-0 text-ink-2">
        For:{' '}
        {c.value?.members.find((m) => m.id === entry.recipientId)?.name ??
          (entry.recipientId ? 'Teammate' : 'Anyone')}
      </p>
      {entry.answer && (
        <p className="m-0 whitespace-pre-wrap">
          Answer: {entry.answer}
          <span className="ml-2 text-ink-3">
            By{' '}
            {c.value?.members.find((m) => m.id === entry.answeredBy)?.name ??
              'Teammate'}
          </span>
        </p>
      )}
      {c.canEdit && entry.pill === 'Open' && (
        <label className="flex items-center gap-2">
          Address to
          <select
            aria-label={`Address question ${entry.id}`}
            className="rounded-item border border-line bg-surface p-1"
            value={entry.recipientId ?? ''}
            disabled={c.busy || !c.value}
            onChange={(e) =>
              void c.command({
                caseId,
                type: 'assign-question',
                entryId: entry.id,
                base: entry.version,
                recipientId: e.target.value || undefined,
              })
            }
          >
            <option value="">Anyone</option>
            {c.value?.members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} · {m.role}
              </option>
            ))}
          </select>
        </label>
      )}
      {entry.pill === 'Open' &&
        entry.recipientId === c.accountId &&
        !pending.length &&
        !answering && (
          <Button disabled={c.busy} onClick={() => setAnswering(true)}>
            Answer question
          </Button>
        )}
      {answering && (
        <Modal title="Answer question" onCancel={() => void close()}>
          <form
            className="space-y-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await c.answer(
                  caseId,
                  entry.id,
                  entry.version,
                  text,
                  request.current,
                )
              ) {
                setAnswering(false);
                setText('');
                request.current = crypto.randomUUID();
              }
            }}
          >
            <label className="block">
              Your answer
              <textarea
                autoFocus
                aria-label={`Answer question ${entry.id}`}
                className="mt-1 block w-full rounded-item border border-line bg-surface p-2 text-body"
                maxLength={4000}
                required
                value={text}
                disabled={c.busy}
                onChange={(e) => setText(e.target.value)}
              />
            </label>
            <Button type="submit" disabled={c.busy || !text.trim()}>
              Submit answer for masking
            </Button>
            <Button
              kind="secondary"
              disabled={c.busy}
              onClick={() => void close()}
            >
              Cancel
            </Button>
            {c.error && (
              <p role="alert" className="text-bad">
                {c.error}
              </p>
            )}
            <p className="m-0 text-ink-3">
              Your answer stays pending until a member completes the masking
              check. Pending answers expire after seven days.
            </p>
          </form>
        </Modal>
      )}
      {pending.map((a) => (
        <div key={a.id} className="flex flex-wrap items-center gap-2">
          <span role="status">Answer waiting for masking</span>
          {c.canEdit && (
            <Button
              disabled={c.busy}
              kind="secondary"
              onClick={() => void c.check(a.id)}
            >
              Check and publish answer
            </Button>
          )}
          {entry.recipientId === c.accountId && (
            <Button
              disabled={c.busy}
              kind="secondary"
              onClick={() => void c.cancel(a.id)}
            >
              Cancel answer
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}
