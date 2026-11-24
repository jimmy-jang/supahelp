import { useState } from 'react';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { sectionTitle } from './caseDoc';
import type { SectionKey } from './types';

const textBtn =
  'rounded-[5px] px-1 text-ink-2 hover:bg-hover disabled:opacity-45 disabled:hover:bg-transparent';

// "Case updated · Findings +1 · Ruled out: double-click   Undo  View"
export function CaseUpdatedLine({
  section,
  what,
  note,
  onUndo,
  onView,
  pending,
}: {
  section: SectionKey;
  what: string;
  note?: string;
  onUndo?: () => void;
  onView: () => void;
  pending?: boolean;
}) {
  return (
    <div className="slide-in-line flex items-center gap-1.5 self-start text-meta text-ink-3">
      <Icon name="doc" size={14} />
      <span>
        Case updated ·{' '}
        <b className="font-medium text-ink-2">{sectionTitle(section)}</b> {what}
      </span>
      {onUndo && (
        <button
          type="button"
          className={textBtn}
          disabled={!!note || pending}
          onClick={onUndo}
        >
          Undo
        </button>
      )}
      <button type="button" className={textBtn} onClick={onView}>
        View
      </button>
      {note && <span role="status">· {note}</span>}
    </div>
  );
}

// Offered after Resolve. Preview: the helpdesk note is never written.
export function ResolveCard({
  playbook,
  ticket,
  choice,
  onChoose,
}: {
  playbook?: string;
  ticket: string;
  choice?: string;
  onChoose: (choice: 'update' | 'create' | 'later') => void;
}) {
  const [note, setNote] = useState(true);
  return (
    <div className="flex flex-col gap-2.5 rounded-card bg-surface px-3.5 py-3 shadow-1">
      <div>
        <b>
          {playbook
            ? `This case used “${playbook}”.`
            : 'This case didn’t use a Playbook.'}
        </b>
        <p className="m-0 mt-0.5 text-ink-2">
          {playbook
            ? 'You also paused the renewal before refunding, which isn’t in the Playbook yet. Update it?'
            : 'Create one so the next person can follow what fixed it?'}
        </p>
      </div>
      {choice ? (
        <p className="m-0 text-meta text-ink-3">{choice}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {playbook && (
            <Button onClick={() => onChoose('update')}>Update Playbook</Button>
          )}
          <Button
            kind={playbook ? 'secondary' : 'primary'}
            onClick={() => onChoose('create')}
          >
            Create a new one
          </Button>
          <Button kind="ghost" onClick={() => onChoose('later')}>
            Not now
          </Button>
        </div>
      )}
      <label className="flex items-center gap-2 text-meta text-ink-2">
        <input
          type="checkbox"
          checked={note}
          onChange={(e) => setNote(e.target.checked)}
          className="size-3.5 accent-[var(--ink)]"
        />
        Add a “what fixed it” note to{' '}
        <span className="font-mono text-[11.5px] tabular-nums">{ticket}</span>{' '}
        (team only)
      </label>
    </div>
  );
}

export function PlaybookReadyCard({
  title,
  onOpen,
}: {
  title: string;
  onOpen: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-card bg-surface px-3.5 py-3 shadow-1">
      <div className="flex items-center gap-2">
        <Icon name="book" />
        <b>Playbook draft ready</b>
      </div>
      <p className="m-0 text-ink-2">
        I drafted “{title}” from this case. Review it, add screenshots if
        useful, then publish.
      </p>
      <div>
        <Button kind="secondary" onClick={onOpen}>
          Open draft
        </Button>
      </div>
    </div>
  );
}
