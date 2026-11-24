import { Avatar } from '../../components/Avatar';
import { Button } from '../../components/Button';
import { DocPanel, DocSection } from '../../components/DocPanel';
import { Icon, IconButton } from '../../components/Icon';
import { member, workspaces } from '../../fixtures/team';
import type { Playbook, Shot } from './types';

// A Playbook: "What is this" and numbered "How to fix it" steps with
// screenshots. Preview: publishing, blurring and the customer-data check are
// simulated and nothing syncs.
export function PlaybookDoc({
  playbook: p,
  expanded,
  onExpand,
  onClose,
  onPublish,
  onDiscard,
  onAddScreenshot,
  onToggleShot,
}: {
  playbook: Playbook;
  expanded: boolean;
  onExpand: () => void;
  onClose: () => void;
  onPublish: () => void;
  onDiscard: () => void;
  onAddScreenshot: () => void;
  onToggleShot: (stepId: string, key: 'clean' | 'blurred') => void;
}) {
  const author = member(p.authorId);
  const team = workspaces.team.find((w) => w.id === workspaces.current)!;
  const unchecked = p.steps.some((s) => s.shot && !s.shot.clean);
  return (
    <DocPanel
      label={`Playbook: ${p.title}`}
      expanded={expanded}
      onExpand={onExpand}
      onClose={onClose}
      header={
        <>
          <span className="text-ink-2">
            <Icon name="book" />
          </span>
          <b className="font-medium">Playbook</b>
          {p.draftFrom && (
            <span className="text-meta text-ink-3">{p.draftFrom}</span>
          )}
        </>
      }
      actions={<IconButton name="history" label="History" />}
    >
      <h1 className="m-0 mt-1.5 mb-3 text-heading font-semibold tracking-[-0.01em]">
        {p.title}
      </h1>
      <div className="-mt-1.5 mb-3.5 flex items-center gap-2 text-meta text-ink-3">
        <Avatar name={author.name} tone={author.tone} />
        {author.name} · last published {p.published} · used in {p.uses} case
        {p.uses === 1 ? '' : 's'}
      </div>

      <DocSection title="What is this">
        <p className="m-0">{p.what}</p>
      </DocSection>

      <DocSection title="How to fix it">
        <ol className="m-0 mt-1 flex list-decimal flex-col gap-2.5 pl-[18px] marker:text-ink-3">
          {p.steps.map((s) => (
            <li
              key={s.id}
              className={
                s.draft ? '-mx-2 rounded-item bg-sunk px-2 py-1.5' : ''
              }
            >
              {s.draft && <b className="font-medium">{s.draft}: </b>}
              {s.text}
              {s.draft && (
                <span className="ml-1 text-[11px] text-ink-3">
                  AI draft · edit or remove
                </span>
              )}
              {s.shot && (
                <ShotBlock
                  shot={s.shot}
                  onToggle={(key) => onToggleShot(s.id, key)}
                />
              )}
            </li>
          ))}
        </ol>
      </DocSection>

      <div className="mt-[18px] flex flex-wrap gap-1.5">
        <Button onClick={onPublish} disabled={!p.draftFrom || unchecked}>
          Publish update
        </Button>
        <Button kind="secondary" onClick={onAddScreenshot}>
          <Icon name="img" size={14} />
          Add screenshot
        </Button>
        <Button kind="ghost" onClick={onDiscard} disabled={!p.draftFrom}>
          Discard draft
        </Button>
      </div>
      <p className="m-0 mt-2 text-meta text-ink-3">
        {unchecked
          ? 'Confirm each screenshot shows no customer data before publishing.'
          : p.draftFrom
            ? `Publishing makes it visible to ${workspaces.org} · ${team.name}. Screenshots sync only after you confirm they show no customer data.`
            : 'No unpublished changes.'}
      </p>
    </DocPanel>
  );
}

function ShotBlock({
  shot,
  onToggle,
}: {
  shot: Shot;
  onToggle: (key: 'clean' | 'blurred') => void;
}) {
  return (
    <div className="mt-1.5 mb-1 flex h-[150px] flex-col justify-between rounded-item bg-sunk p-2.5">
      <div
        aria-hidden="true"
        className={`flex flex-col gap-1.5 ${shot.blurred ? 'blur-[3px]' : ''}`}
      >
        <i className="block h-2 w-3/5 rounded bg-line" />
        <i className="block h-2 w-[85%] rounded bg-line" />
        <i className="block h-2 w-2/5 rounded bg-line" />
      </div>
      <div className="flex items-center gap-2 text-[11.5px] text-ink-3">
        <Icon name="img" size={14} />
        {shot.label}
        <span className="flex-1" />
        <label
          className={`flex items-center gap-1 ${shot.clean ? 'text-ok' : ''}`}
        >
          <input
            type="checkbox"
            checked={shot.clean}
            onChange={() => onToggle('clean')}
            className="size-3 accent-[var(--ok)]"
          />
          No customer data
        </label>
        <button
          type="button"
          aria-pressed={shot.blurred}
          onClick={() => onToggle('blurred')}
          className={`inline-flex items-center gap-1 rounded-chip px-2 py-[3px] hover:bg-hover ${shot.blurred ? 'bg-hover text-ink-2' : ''}`}
        >
          <Icon name="blur" size={13} />
          Blur
        </button>
      </div>
    </div>
  );
}
