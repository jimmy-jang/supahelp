import { useEffect, useRef, useState } from 'react';
import type {
  CaseEntry,
  CaseRecord,
  EntryValue,
  SectionKey,
} from '../../../contracts/cases';
import { Button } from '../../components/Button';
import { useConfirmation } from '../../components/ConfirmationProvider';
import { Select } from '../../components/controls';
import { Modal } from '../../components/Modal';
import { sectionTitle } from './caseDoc';
import type { useCases } from './useCases';

const field =
  'mt-1 w-full rounded-item border border-line bg-surface p-2 text-body text-ink focus-visible:outline-2 focus-visible:outline-busy';
const valueOf = (e: EntryValue): EntryValue => ({
  section: e.section,
  kind: e.kind,
  label: e.label,
  text: e.text,
  detail: e.detail,
  pill: e.pill,
});

export function CaseEntryEditor({
  record,
  section,
  entry,
  actions,
  onClose,
}: {
  record: CaseRecord;
  section: SectionKey;
  entry?: CaseEntry;
  actions: ReturnType<typeof useCases>;
  onClose(): void;
}) {
  const confirm = useConfirmation();
  const [base, setBase] = useState(entry);
  const initial: EntryValue = entry
    ? valueOf(entry)
    : {
        section,
        kind: ['summary', 'next'].includes(section)
          ? 'text'
          : ['findings', 'actions', 'questions'].includes(section)
            ? 'item'
            : 'row',
        text: '',
        ...(['customer', 'problem', 'reproduction'].includes(section)
          ? { label: '' }
          : {}),
        ...(section === 'findings'
          ? { pill: 'Guess' }
          : section === 'actions'
            ? { pill: 'Proposed' }
            : section === 'questions'
              ? { pill: 'Open' }
              : {}),
      };
  const [value, setValue] = useState(initial);
  const original = useRef(initial);
  const requestId = useRef(crypto.randomUUID());
  const pending = useRef(false);
  const confirming = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const current = record.entries.find(
    (e) => e.id === (base?.id ?? requestId.current),
  );
  const conflict = base
    ? !current || current.version !== base.version
    : !!current;
  const dirty = JSON.stringify(value) !== JSON.stringify(original.current);
  const state = useRef('');
  state.current = JSON.stringify([value, current, busy, conflict]);
  const cancelCheck = () => {
    void actions
      .cancelEdit(requestId.current)
      .catch(() =>
        setError(
          'Cancellation could not be confirmed. Wait for the check to finish.',
        ),
      );
  };
  const cancelRef = useRef(cancelCheck);
  cancelRef.current = cancelCheck;
  useEffect(
    () => () => {
      if (pending.current) cancelRef.current();
    },
    [],
  );
  useEffect(() => {
    if (!dirty && !busy) return;
    const prevent = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', prevent);
    return () => window.removeEventListener('beforeunload', prevent);
  }, [dirty, busy]);
  const close = async () => {
    if (busy || confirming.current) return;
    const before = state.current;
    confirming.current = true;
    const accepted =
      !dirty ||
      (await confirm({
        title: 'Discard unsaved entry edits?',
        description:
          'Your unsaved changes will be lost. The saved case will stay as it is.',
        cancel: 'Keep editing',
        action: 'Discard changes',
        danger: true,
      }));
    confirming.current = false;
    if (!accepted) return;
    if (state.current === before) onClose();
  };
  const save = async (remove = false) => {
    if (pending.current || conflict || confirming.current) return;
    pending.current = true;
    setBusy(true);
    setError(undefined);
    const common = { caseId: record.id, requestId: requestId.current };
    const result = await actions.edit(
      base
        ? remove
          ? {
              ...common,
              action: 'remove',
              entryId: base.id,
              version: base.version,
            }
          : {
              ...common,
              action: 'update',
              entryId: base.id,
              version: base.version,
              value,
            }
        : { ...common, action: 'add', value },
    );
    pending.current = false;
    setBusy(false);
    if (result.ok) onClose();
    else setError(result.error);
  };
  return (
    <Modal
      title={`${base ? 'Edit' : 'Add'} ${sectionTitle(section)} entry`}
      onCancel={() => void close()}
    >
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        {value.kind === 'row' && (
          <label className="block">
            Label
            <input
              aria-label="Entry label"
              className={field}
              maxLength={120}
              required
              value={value.label ?? ''}
              disabled={busy}
              onChange={(e) => setValue({ ...value, label: e.target.value })}
            />
          </label>
        )}
        <label className="block">
          Text
          <textarea
            autoFocus
            aria-label="Entry text"
            className={`${field} min-h-32`}
            maxLength={4000}
            required
            value={value.text}
            disabled={busy}
            onChange={(e) => setValue({ ...value, text: e.target.value })}
          />
        </label>
        <label className="block">
          {section === 'findings'
            ? 'Evidence link or reference'
            : 'Detail (optional)'}
          <input
            aria-label="Entry detail"
            className={field}
            maxLength={2000}
            value={value.detail ?? ''}
            disabled={busy}
            onChange={(e) =>
              setValue({ ...value, detail: e.target.value || undefined })
            }
          />
        </label>
        {value.kind === 'item' && (
          <label className="flex items-center justify-between">
            {section === 'findings' ? 'Verdict' : 'State'}
            <Select
              label="Entry state"
              disabled={busy}
              options={
                section === 'findings'
                  ? ['Guess', 'Confirmed', 'Ruled out']
                  : section === 'actions'
                    ? ['Proposed']
                    : base?.recipientId && base.pill === 'Open'
                      ? ['Open']
                      : ['Open', 'Answered']
              }
              value={value.pill}
              onChange={(pill) => setValue({ ...value, pill })}
            />
          </label>
        )}
        <p className="text-meta text-ink-2">
          Save checks and masks text using your selected model in Settings. This
          uses provider usage. Actions here remain proposals.
        </p>
        {conflict && (
          <div role="alert" className="space-y-2 rounded-item bg-sunk p-3">
            <p className="m-0">
              This entry changed. Your unsaved text is kept above. Review the
              current entry before saving.
            </p>
            <p className="m-0 whitespace-pre-wrap">
              Current: {current?.text ?? 'Removed'}
            </p>
            {current && (
              <Button
                kind="secondary"
                onClick={() => {
                  setBase(current);
                  const next = valueOf(current);
                  setValue(next);
                  original.current = next;
                  setError(undefined);
                }}
              >
                Load current entry
              </Button>
            )}
          </div>
        )}
        {error && (
          <p role="alert" className="text-bad">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="submit"
            aria-label="Save entry"
            disabled={busy || conflict || !value.text.trim()}
          >
            Save entry
          </Button>
          <Button kind="secondary" disabled={busy} onClick={close}>
            Cancel
          </Button>
          {base && (
            <Button
              kind="danger"
              disabled={busy || conflict}
              onClick={async () => {
                if (confirming.current) return;
                const before = state.current;
                confirming.current = true;
                const accepted = await confirm({
                  title: 'Remove this entry?',
                  description:
                    'You can undo this change from the case history.',
                  action: 'Remove entry',
                  danger: true,
                });
                confirming.current = false;
                if (accepted && state.current === before) void save(true);
              }}
            >
              Remove entry
            </Button>
          )}
        </div>
        {busy && (
          <div
            role="status"
            className="flex items-center justify-between text-meta"
          >
            <span className="shimmer">Checking and saving…</span>
            <Button kind="ghost" onClick={cancelCheck}>
              Cancel
            </Button>
          </div>
        )}
      </form>
    </Modal>
  );
}
