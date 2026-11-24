import { useEffect, useState } from 'react';
import type { SyncStatus } from '../../../contracts/sync';
import { Button } from '../../components/Button';
import { useConfirmation } from '../../components/ConfirmationProvider';
import { useAccount } from '../accounts/AccountProvider';

export function PrivacyReview({ revision }: { revision: number }) {
  const { snapshot: account, isCurrent } = useAccount(),
    confirm = useConfirmation();
  const [status, setStatus] = useState<SyncStatus>({
    state: 'checking',
    pending: 0,
  });
  const [hidden, setHidden] = useState<string[]>([]),
    [selected, setSelected] = useState(''),
    [title, setTitle] = useState(''),
    [text, setText] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void window.supahelp
      .getSync(account.context)
      .then((r) => {
        if (active && isCurrent(account.context) && r.ok) {
          setStatus(r.value);
          setHidden(r.value.hidden ?? []);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [revision, account.context, isCurrent]);
  return (
    <div className="space-y-2 pb-2 text-meta empty:hidden">
      {(status.warning || status.pending > 0) && (
        <p className="m-0 text-ink-2">
          {status.warning ??
            'Unsynced changes are lost on removal or sign-out.'}
        </p>
      )}
      {status.review?.map((candidate) => (
        <details key={candidate.id} className="text-left">
          <summary>Saved change needs review</summary>
          <p>Reopen the document and apply the reviewed text.</p>
          <pre className="whitespace-pre-wrap">
            {candidate.title ??
              candidate.value?.text ??
              candidate.content?.markdown ??
              'The document changed before this operation could be accepted.'}
          </pre>
        </details>
      ))}
      {hidden.length > 0 && (
        <section
          aria-label="Customer data corrections"
          className="space-y-2 border-t border-line pt-3 text-left text-meta"
        >
          <h2 className="font-semibold">Hidden documents</h2>
          <p>
            Replace a flagged document with reviewed text. This removes its
            history and all screenshots.
          </p>
          <label className="block">
            Document
            <select
              aria-label="Hidden document"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              className="ml-2 rounded-item bg-sunk p-1"
            >
              <option value="">Choose a hidden document</option>
              {hidden.map((id, i) => (
                <option key={id} value={id}>
                  Hidden document {i + 1}
                </option>
              ))}
            </select>
          </label>
          <input
            aria-label="Corrected document title"
            placeholder="Corrected title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
            className="w-full rounded-item border border-line bg-surface p-2"
          />
          <textarea
            aria-label="Corrected document text"
            placeholder="Reviewed replacement text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={32000}
            className="min-h-24 w-full rounded-item border border-line bg-surface p-2"
          />
          <Button
            disabled={busy || !selected || !title.trim() || !text.trim()}
            onClick={async () => {
              if (
                !(await confirm({
                  title: 'Replace this flagged document?',
                  description:
                    'Its current text, history, conflicts and screenshots will be removed. The replacement is checked for masking before it becomes available.',
                  action: 'Replace and unhide',
                  danger: true,
                }))
              )
                return;
              setBusy(true);
              try {
                const r = await window.supahelp.correctSharedDocument({
                  context: account.context,
                  id: selected,
                  title,
                  text,
                });
                if (isCurrent(account.context)) {
                  setNotice(
                    r.ok ? 'Correction saved or queued for sync.' : r.error,
                  );
                  if (r.ok) {
                    setSelected('');
                    setTitle('');
                    setText('');
                  }
                }
              } finally {
                setBusy(false);
              }
            }}
          >
            Replace and unhide
          </Button>
          {notice && <p role="status">{notice}</p>}
        </section>
      )}
    </div>
  );
}
