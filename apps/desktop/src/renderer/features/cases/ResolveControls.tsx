import { useEffect, useState } from 'react';
import { Button } from '../../components/Button';
import type { usePlaybooks } from '../playbooks/usePlaybooks';
import type { Case } from './types';

export function ResolveControls({
  kase,
  chatId,
  shared,
  documents,
  hasCreatedPlaybook,
  onOpenPlaybook,
}: {
  kase: Case;
  chatId?: string;
  shared: boolean;
  documents: ReturnType<typeof usePlaybooks>;
  hasCreatedPlaybook: boolean;
  onOpenPlaybook(id: string): void;
}) {
  const drafts = documents.resolutions.filter((r) => r.caseId === kase.id);
  const draft =
    drafts.find((r) => !r.committed) ?? drafts.find((r) => r.committed);
  const [text, setText] = useState(draft?.text ?? '');
  const [playbook, setPlaybook] = useState(draft?.playbookId ?? '');
  useEffect(() => {
    setText(draft?.text ?? '');
    setPlaybook(draft?.playbookId ?? '');
  }, [draft?.id, draft?.version]);
  const books = documents.playbooks.filter((p) => p.published);
  const selectedPlaybook = books.some((p) => p.id === playbook) ? playbook : '';
  const busy = documents.busy;
  return (
    <section
      aria-label="Resolve and Playbooks"
      className="space-y-2 border-b border-line pb-3 text-meta"
    >
      {kase.status !== 'done' ? (
        <>
          <Button
            kind="secondary"
            disabled={busy}
            onClick={() =>
              void documents.run('draftResolution', {
                caseId: kase.id,
                chatId,
                ...(draft && !draft.committed
                  ? { id: draft.id, version: draft.version }
                  : { requestId: crypto.randomUUID() }),
              })
            }
          >
            {draft && !draft.committed
              ? 'Regenerate Resolution'
              : 'Draft Resolution'}
          </Button>
          {draft && !draft.committed && (
            <>
              <label className="block">
                Resolution
                <textarea
                  aria-label="Resolution draft"
                  className="mt-1 min-h-24 w-full rounded-item border border-line bg-surface p-2 text-body"
                  maxLength={4000}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
              </label>
              {!shared && (
                <label className="block">
                  Playbook used
                  <select
                    className="ml-2 rounded-item bg-sunk p-1"
                    value={selectedPlaybook}
                    onChange={(e) => setPlaybook(e.target.value)}
                  >
                    <option value="">None</option>
                    {books.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.published!.title}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className="flex gap-2">
                <Button
                  kind="secondary"
                  disabled={busy || !text.trim()}
                  onClick={() =>
                    void documents.run('draftResolution', {
                      caseId: kase.id,
                      chatId,
                      id: draft.id,
                      version: draft.version,
                      text,
                      playbookId: selectedPlaybook || undefined,
                    })
                  }
                >
                  Save Resolution draft
                </Button>
                <Button
                  disabled={
                    busy ||
                    text !== draft.text ||
                    selectedPlaybook !== (draft.playbookId ?? '')
                  }
                  onClick={() =>
                    void documents.run('confirmResolve', {
                      id: draft.id,
                      version: draft.version,
                      chatId,
                    })
                  }
                >
                  Confirm Resolve
                </Button>
              </div>
              <p className="text-ink-3">
                Confirmation marks this Supahelp case resolved. External actions
                still require approval.
              </p>
            </>
          )}
        </>
      ) : (
        <>
          <span className="text-ok">Resolved</span>
          <Button
            kind="ghost"
            disabled={busy}
            onClick={() =>
              void documents.run('reopenCase', { caseId: kase.id })
            }
          >
            Reopen case
          </Button>
          {!shared && draft?.committed && (
            <div className="flex flex-wrap gap-2">
              {books.some((p) => p.id === draft.playbookId) && (
                <Button
                  kind="secondary"
                  disabled={busy}
                  onClick={() =>
                    void documents
                      .run('draftCasePlaybook', {
                        id: draft.id,
                        playbookId: draft.playbookId,
                      })
                      .then((p) => {
                        if (p) onOpenPlaybook(p.id);
                      })
                  }
                >
                  Update used Playbook
                </Button>
              )}
              {!hasCreatedPlaybook && (
                <Button
                  kind="secondary"
                  disabled={busy}
                  onClick={() =>
                    void documents
                      .run('draftCasePlaybook', { id: draft.id })
                      .then((p) => {
                        if (p) onOpenPlaybook(p.id);
                      })
                  }
                >
                  Create Playbook from resolution
                </Button>
              )}
              {kase.ticket && (
                <Button
                  kind="ghost"
                  disabled={busy}
                  onClick={() =>
                    void documents.run('proposeResolutionNote', {
                      id: draft.id,
                      chatId,
                    })
                  }
                >
                  Propose Zendesk internal note
                </Button>
              )}
            </div>
          )}
        </>
      )}
      {busy && (
        <div
          role="status"
          className="flex items-center justify-between text-meta"
        >
          <span className="shimmer">Checking and saving…</span>
          <Button kind="ghost" onClick={documents.cancel}>
            Cancel
          </Button>
        </div>
      )}
      {documents.error && (
        <p role="alert" className="text-bad">
          {documents.error}
        </p>
      )}
    </section>
  );
}
