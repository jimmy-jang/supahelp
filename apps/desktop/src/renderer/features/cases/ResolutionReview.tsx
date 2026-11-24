import type { Conversation } from '../../../contracts/chat';
import type { ResolutionDraft } from '../../../contracts/playbooks';
import { Button } from '../../components/Button';
import type { usePlaybooks } from '../playbooks/usePlaybooks';
import type { Case } from './types';

export function ResolutionReview({
  kase,
  draft,
  chat,
  documents,
}: {
  kase: Case;
  draft: ResolutionDraft;
  chat: Conversation;
  documents: ReturnType<typeof usePlaybooks>;
}) {
  const busy = documents.busy || chat.status !== 'idle';
  const answer = (cancel: boolean) =>
    void documents.run('confirmResolve', {
      id: draft.id,
      version: draft.version,
      chatId: chat.id,
      cancel,
    });
  return (
    <section
      aria-label="Review resolution"
      className="flex flex-col gap-2.5 rounded-card bg-surface px-3.5 py-3 shadow-1"
    >
      <b>
        Resolution draft · #{kase.number} {kase.title}
      </b>
      <p className="m-0 max-h-64 overflow-auto whitespace-pre-wrap break-words">
        {draft.text}
      </p>
      <p className="m-0 text-meta text-ink-2">
        Confirming marks this Supahelp case resolved.
      </p>
      {documents.error && (
        <p role="alert" className="m-0 text-bad">
          {documents.error}
        </p>
      )}
      <div className="flex gap-2">
        <Button disabled={busy} onClick={() => answer(false)}>
          Confirm Resolve
        </Button>
        <Button kind="secondary" disabled={busy} onClick={() => answer(true)}>
          Cancel
        </Button>
      </div>
    </section>
  );
}
