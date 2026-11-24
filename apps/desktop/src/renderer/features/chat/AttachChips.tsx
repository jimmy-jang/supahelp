import { useState } from 'react';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { Modal } from '../../components/Modal';
import { Popover, menuRow } from '../../components/Popover';
import { searchSidebar } from '../../layout/searchSidebar';
import type { Attached, Case, Target } from '../cases/types';
import type { Playbook } from '../playbooks/types';

export type AttachProps = {
  attached: Attached;
  cases: Case[];
  playbooks: Playbook[];
  onAttach: (t: Target) => void;
  onDetach: (t: Target) => void;
};

// Attached items above the text: at most one case, any number of Playbooks.
export function AttachedChips({
  attached,
  cases,
  playbooks,
  onDetach,
  onOpen,
  disabled = false,
}: Pick<AttachProps, 'attached' | 'cases' | 'playbooks'> & {
  onDetach?: AttachProps['onDetach'];
  onOpen?: (t: Target) => void;
  disabled?: boolean;
}) {
  const kase = cases.find((c) => c.id === attached.caseId);
  const books = playbooks.filter((p) => attached.playbookIds.includes(p.id));
  if (!kase && !books.length) return null;
  const chip = (key: string, icon: 'doc' | 'book', name: string, t: Target) => (
    <span
      key={key}
      className="inline-flex max-w-[320px] items-center gap-1.5 rounded-chip bg-sunk py-[3px] pr-1.5 pl-2 text-meta"
    >
      <span className="text-ink-2">
        <Icon name={icon} size={14} />
      </span>
      {onOpen ? (
        <button
          type="button"
          title={`Open ${name}`}
          onClick={() => onOpen(t)}
          className="truncate hover:underline"
        >
          {name}
        </button>
      ) : (
        <span className="truncate">{name}</span>
      )}
      {onDetach && (
        <button
          type="button"
          aria-label={`Remove ${name}`}
          disabled={disabled}
          onClick={() => onDetach(t)}
          className="shrink-0 px-0.5 text-ink-3 hover:text-ink disabled:opacity-40"
        >
          ×
        </button>
      )}
    </span>
  );
  return (
    <div className="flex flex-wrap gap-2">
      {kase &&
        chip('case', 'doc', `Case #${kase.number} · ${kase.title}`, {
          caseId: kase.id,
        })}
      {books.map((p) => chip(p.id, 'book', p.title, { playbookId: p.id }))}
    </div>
  );
}

// Shared by the real and preview chat attachment menus.
export function AttachmentPicker({
  attached,
  cases,
  playbooks,
  onAttach,
  disabled = false,
}: AttachProps & { disabled?: boolean }) {
  const [kind, setKind] = useState<'case' | 'playbook'>();
  const [query, setQuery] = useState('');
  const results = searchSidebar(
    {
      chats: [],
      cases: kind === 'case' ? cases : [],
      playbooks: kind === 'playbook' ? playbooks : [],
    },
    query,
  );
  return (
    <>
      {(['case', 'playbook'] as const).map((value) => (
        <button
          key={value}
          type="button"
          className={menuRow}
          disabled={disabled}
          onClick={() => {
            setQuery('');
            setKind(value);
          }}
        >
          <Icon name={value === 'case' ? 'doc' : 'book'} size={14} />
          Add a {value}
        </button>
      ))}
      {kind && (
        <Modal title={`Add a ${kind}`} onCancel={() => setKind(undefined)}>
          <input
            autoFocus
            aria-label={`Search ${kind === 'case' ? 'cases' : 'playbooks'}`}
            placeholder={
              kind === 'case'
                ? 'Search by title, number, customer or ticket'
                : 'Search playbooks'
            }
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="mb-3 w-full rounded-item bg-sunk px-3 py-2 outline-none"
          />
          <div className="max-h-[40vh] overflow-y-auto">
            {results.map((result) => {
              const selected =
                kind === 'case'
                  ? attached.caseId === result.id
                  : attached.playbookIds.includes(result.id);
              const kase =
                kind === 'case'
                  ? cases.find((c) => c.id === result.id)
                  : undefined;
              return (
                <button
                  key={result.id}
                  type="button"
                  className={menuRow}
                  disabled={disabled || selected}
                  onClick={() => {
                    onAttach(
                      kind === 'case'
                        ? { caseId: result.id }
                        : { playbookId: result.id },
                    );
                    setKind(undefined);
                  }}
                >
                  <Icon name={kind === 'case' ? 'doc' : 'book'} size={14} />
                  <span className="flex-1 truncate">
                    {kase ? `#${kase.number} · ` : ''}
                    {result.title}
                  </span>
                  {selected && <Icon name="check" size={13} />}
                </button>
              );
            })}
            {!results.length && (
              <p role="status" className="text-ink-3">
                {query.trim()
                  ? 'No matches found.'
                  : `No ${kind === 'case' ? 'cases' : 'playbooks'} available.`}
              </p>
            )}
          </div>
          <div className="mt-4 flex justify-end">
            <Button kind="ghost" onClick={() => setKind(undefined)}>
              Cancel
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}

export function AttachMenu(props: AttachProps) {
  return (
    <Popover
      title="Attach a case or Playbook"
      area="top span-right"
      className="max-h-[60vh] w-[300px] overflow-y-auto"
      buttonClass="inline-flex items-center rounded-chip px-2 py-[3px] hover:bg-hover"
      label={<Icon name="plus" size={15} />}
    >
      <AttachmentPicker {...props} />
      <p className="m-1 text-meta text-ink-3">
        You can also drag a case from the sidebar, or paste a case link.
      </p>
    </Popover>
  );
}

// Repo chip with the fixed defaults from the brief (no settings page).
export function RepoChip() {
  const rules = [
    'Reads code',
    'Edits and checks ask first',
    'Never commits, pushes or deploys',
    'Skips .env, secrets and ignored files',
  ];
  return (
    <Popover
      title="Repository"
      area="top span-right"
      className="w-[260px]"
      buttonClass="inline-flex items-center gap-1 rounded-chip px-2 py-[3px] hover:bg-hover"
      label={
        <>
          <Icon name="code" size={14} />
          web-app
          <Icon name="down" size={12} />
        </>
      }
    >
      <div className="px-2 pt-1 pb-1.5 font-mono text-[11.5px]">
        ~/code/brightway/web-app
      </div>
      <ul className="m-0 flex list-none flex-col gap-1 px-2 pb-1.5 text-meta text-ink-2">
        {rules.map((r) => (
          <li key={r} className="flex items-center gap-1.5">
            <Icon name="check" size={12} />
            {r}
          </li>
        ))}
      </ul>
      <p className="m-0 px-2 pb-1 text-meta text-ink-3">
        Preview. These defaults are fixed.
      </p>
    </Popover>
  );
}
