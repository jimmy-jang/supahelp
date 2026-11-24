import { useCallback, useRef, useState, type ReactNode } from 'react';
import { Avatar } from '../components/Avatar';
import { useConfirmation } from '../components/ConfirmationProvider';
import { Icon, IconButton } from '../components/Icon';
import { InlineTitle } from '../components/InlineTitle';
import { Popover, menuRow } from '../components/Popover';
import { shortcutLabel } from '../components/shortcuts';
import { useAccount } from '../features/accounts/AccountProvider';
import { filterCases, type CaseFilter } from '../features/cases/filterCases';
import { STATUS } from '../features/cases/status';
import { CASE_DRAG_TYPE, type Case } from '../features/cases/types';
import type { Chat } from '../features/chat/types';
import type { Playbook } from '../features/playbooks/types';
import type { SettingsPage } from '../features/settings/pages';
import { member } from '../fixtures/team';
import { useUpdateState } from '../features/settings/useUpdateState';
import { AccountMenu } from './AccountMenu';
import { SidebarSearch } from './SidebarSearch';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';

type View =
  | { kind: 'home' }
  | { kind: 'chat'; id: string }
  | { kind: 'case'; id: string }
  | { kind: 'notifications' }
  | { kind: 'settings'; page: SettingsPage };

const RECENT_CHATS = 4;
const VISIBLE_CASES = 8;
const RECENT_PLAYBOOKS = 3;

const row =
  'flex h-[30px] min-w-0 items-center gap-2 rounded-item px-2 text-left';
const rowState = (on: boolean) =>
  on ? 'bg-surface shadow-1 text-ink' : 'text-ink hover:bg-hover';

type ItemKind = 'chat' | 'case' | 'playbook';
const itemLabel = { chat: 'chat', case: 'case', playbook: 'Playbook' };

function SidebarItem({
  kind,
  value,
  selected,
  onRename,
  onRemove,
  children,
}: {
  kind: ItemKind;
  value: string;
  selected: boolean;
  onRename(title: string, expectedTitle: string): Promise<string>;
  // Omitted when the viewer may not remove it (team cases/Playbooks: admins only).
  onRemove?(): Promise<void>;
  children: ReactNode;
}) {
  const confirm = useConfirmation();
  const ref = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState('');
  const label = itemLabel[kind];
  const remove = async () => {
    if (
      !(await confirm({
        title: `Remove ${label}?`,
        description: `“${value}” will be removed from this workspace.`,
        action: `Remove ${label}`,
        danger: true,
      }))
    )
      return;
    setRemoving(true);
    setError('');
    try {
      await onRemove!();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : `The ${label} could not be removed. Try again.`,
      );
    } finally {
      setRemoving(false);
    }
  };
  return (
    <div ref={ref} className={`min-w-0 rounded-item ${rowState(selected)}`}>
      {editing ? (
        <div className="px-1 py-0.5">
          <InlineTitle
            label={`Sidebar ${label} title`}
            value={value}
            onSave={onRename}
            onClose={() => {
              setEditing(false);
              requestAnimationFrame(() =>
                ref.current
                  ?.querySelector<HTMLButtonElement>('button[popovertarget]')
                  ?.focus(),
              );
            }}
          />
        </div>
      ) : (
        <div className="group/item flex min-w-0 items-start">
          {children}
          <Popover
            title={`Actions for ${value}`}
            label={<Icon name="more" size={14} />}
            buttonClass="mt-0.5 mr-1 grid size-6 shrink-0 place-items-center rounded-item text-ink-3 opacity-0 hover:bg-hover focus-visible:opacity-100 group-hover/item:opacity-100 group-focus-within/item:opacity-100"
            area="bottom span-left"
            className="w-36"
          >
            <button
              type="button"
              className={menuRow}
              disabled={removing}
              onClick={() => {
                setError('');
                setEditing(true);
              }}
            >
              <Icon name="edit" size={14} /> Rename
            </button>
            {onRemove && (
              <button
                type="button"
                className={`${menuRow} text-bad`}
                disabled={removing}
                onClick={() => void remove()}
              >
                <Icon name="trash" size={14} /> Remove
              </button>
            )}
          </Popover>
        </div>
      )}
      {error && (
        <p role="alert" className="m-0 px-2 pb-1 text-meta text-bad">
          {error}
        </p>
      )}
    </div>
  );
}

export function Sidebar({
  chats,
  cases,
  playbooks,
  view,
  openPlaybook,
  onHome,
  team,
  onOpenChat,
  onOpenCase,
  onOpenPlaybook,
  onNewPlaybook,
  onNewCase,
  creatingCase,
  newCaseHint,
  syncStatus,
  notifications,
  creatingPlaybook,
  playbookBusy,
  createPlaybookError,
  onCollapse,
  onOpenSettings,
  onQuickTour,
  onContextChange,
  onRenameItem,
  onRemoveItem,
  draftCaseIds,
  draftPlaybookIds,
}: {
  chats: Chat[];
  cases: Case[];
  playbooks: Playbook[];
  // Saved-but-unconfirmed drafts; their rows render greyed out.
  draftCaseIds?: ReadonlySet<string>;
  draftPlaybookIds?: ReadonlySet<string>;
  view: View;
  openPlaybook?: string;
  onOpenPlaybook: (id: string) => void;
  onNewPlaybook?: () => void;
  // Team: a shared case. Personal: a case from the open chat (hint explains when unavailable).
  onNewCase?: () => void;
  creatingCase?: boolean;
  newCaseHint?: string;
  syncStatus?: ReactNode;
  // The notification bell, shown beside the collapse button.
  notifications?: ReactNode;
  creatingPlaybook?: boolean;
  playbookBusy?: boolean;
  createPlaybookError?: boolean;
  onHome: () => void;
  team: boolean;
  onOpenChat: (id: string) => void;
  onOpenCase: (id: string) => void;
  onCollapse: () => void;
  onOpenSettings: (page: SettingsPage) => void;
  onQuickTour: () => void;
  onContextChange: () => Promise<boolean>;
  onRenameItem(
    kind: ItemKind,
    id: string,
    title: string,
    expectedTitle: string,
  ): Promise<string>;
  onRemoveItem(kind: ItemKind, id: string): Promise<void>;
}) {
  const { snapshot: account } = useAccount();
  const updateReady = useUpdateState()?.status === 'ready';
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<CaseFilter>('Mine');
  const [showAllCases, setShowAllCases] = useState(false);
  const [showAllChats, setShowAllChats] = useState(false);
  const [showAllPlaybooks, setShowAllPlaybooks] = useState(false);
  const [menu, setMenu] = useState(false);
  const closeMenu = useCallback(() => setMenu(false), []);
  const q = query.trim().toLowerCase();
  const personId =
    account.context.context.kind === 'personal'
      ? 'local'
      : account.context.accountId;
  const found = filterCases(cases, filter, personId, query);
  const scope = account.context.context;
  const admin =
    scope.kind !== 'team' ||
    account.view?.workspaces.find((w) => w.id === scope.workspaceId)?.role ===
      'admin';
  const itemActions = (kind: ItemKind, id: string) => ({
    kind,
    onRename: (title: string, expectedTitle: string) =>
      onRenameItem(kind, id, title, expectedTitle),
    onRemove:
      kind === 'chat' || admin ? () => onRemoveItem(kind, id) : undefined,
  });

  return (
    <aside className="relative flex w-[272px] flex-none flex-col bg-sidebar">
      <div className="drag flex h-[52px] flex-none items-center justify-end gap-0.5 px-2.5">
        {notifications}
        <IconButton
          name="panel"
          label={`Hide sidebar (${shortcutLabel('\\')})`}
          onClick={onCollapse}
        />
      </div>

      <WorkspaceSwitcher
        onContextChange={onContextChange}
        onSettings={() => onOpenSettings('workspace')}
        onBilling={() => onOpenSettings('billing')}
        onNewOrganization={() => onOpenSettings('new-organization')}
      />

      <section className="flex flex-col px-2 pt-1 pb-2.5" aria-label="Chats">
        <h2 className="flex h-[26px] items-center px-2 text-meta font-normal text-ink-3">
          Chats
        </h2>
        <button
          type="button"
          onClick={onHome}
          className={`${row} ${rowState(view.kind === 'home')}`}
        >
          <span className="text-ink-2">
            <Icon name="edit" />
          </span>
          {team ? 'New personal chat' : 'New chat'}
        </button>
        <div className={showAllChats ? 'max-h-48 overflow-y-auto' : undefined}>
          {chats.slice(0, showAllChats ? undefined : RECENT_CHATS).map((c) => (
            <SidebarItem
              key={c.id}
              value={c.title}
              selected={view.kind === 'chat' && view.id === c.id}
              {...itemActions('chat', c.id)}
            >
              <button
                type="button"
                onClick={() => onOpenChat(c.id)}
                className={`${row} flex-1`}
              >
                <span className="truncate">{c.title}</span>
              </button>
            </SidebarItem>
          ))}
        </div>
        {chats.length > RECENT_CHATS && (
          <button
            type="button"
            aria-expanded={showAllChats}
            onClick={() => setShowAllChats(!showAllChats)}
            className={`${row} text-ink-3 hover:bg-hover`}
          >
            {showAllChats ? 'Show fewer' : 'Show all'}
          </button>
        )}
      </section>

      <div className="mb-1.5 h-px flex-none bg-line" />

      <section
        className="flex min-h-0 flex-1 flex-col px-2 pt-1"
        aria-label="Cases"
      >
        <div className="flex h-[26px] items-center px-2 text-meta text-ink-3">
          <h2 className="flex-1 font-normal">Cases</h2>
          <Popover
            title="Filter cases"
            buttonClass="flex items-center gap-0.5 rounded-[5px] px-1 hover:bg-hover hover:text-ink-2"
            className="w-[190px]"
            area="bottom span-left"
            label={
              <>
                {filter} <Icon name="down" size={12} />
              </>
            }
          >
            {(['Mine', 'Contributing', 'All cases'] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={filter === option}
                className={menuRow}
                onClick={() => {
                  setFilter(option);
                  setShowAllCases(false);
                }}
              >
                <span className="flex-1">{option}</span>
                {filter === option && <Icon name="check" size={14} />}
              </button>
            ))}
          </Popover>
        </div>
        <label className="mt-0.5 mb-1.5 flex h-7 items-center gap-2 rounded-item bg-field px-2 text-ink-3">
          <Icon name="search" size={14} />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setShowAllCases(false);
            }}
            placeholder="Search cases or customers"
            className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-3"
          />
          <kbd className="font-sans text-[10.5px]">{shortcutLabel('K')}</kbd>
        </label>
        {onNewCase && (
          <button
            type="button"
            className={`${row} ${rowState(false)} mb-px cursor-pointer active:bg-hover disabled:cursor-default disabled:opacity-60`}
            onClick={onNewCase}
            disabled={creatingCase || !!newCaseHint}
            title={newCaseHint}
          >
            <span className="text-ink-2">
              <Icon name="edit" />
            </span>
            {creatingCase
              ? 'Creating case…'
              : team
                ? 'New shared case'
                : 'New case'}
          </button>
        )}

        <div className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto pb-2">
          {found.slice(0, showAllCases ? undefined : VISIBLE_CASES).map((c) => {
            const s = STATUS[c.status];
            const draft = draftCaseIds?.has(c.id);
            const on =
              (view.kind === 'case' && view.id === c.id) ||
              (view.kind === 'chat' && view.id === c.chatId);
            const owner = member(c.doc.ownerId);
            const localOwnerName =
              owner.id === 'local' ? account.view?.account.name : undefined;
            return (
              <SidebarItem
                key={c.id}
                value={c.title}
                selected={on}
                {...itemActions('case', c.id)}
              >
                <button
                  type="button"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(CASE_DRAG_TYPE, c.id);
                    e.dataTransfer.effectAllowed = 'link';
                  }}
                  onClick={() => onOpenCase(c.id)}
                  title={`${c.example ? 'Example case' : 'Case'} #${c.number}${c.ticket ? ` · ${c.ticket}` : ''} · ${s.label}${draft ? ' · Draft resolution' : ''}`}
                  className={`${draft ? 'text-ink-3' : ''} grid min-w-0 flex-1 grid-cols-[8px_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-px rounded-item px-2 py-[7px] text-left`}
                >
                  <span className={`size-[7px] rounded-full ${s.dot}`} />
                  <span className="truncate">{c.title}</span>
                  <span className="text-[11px] text-ink-3">{c.time}</span>
                  <span className="col-start-2 col-end-4 flex min-w-0 items-center gap-1.5 text-[11.5px] text-ink-3">
                    <span className="min-w-0 flex-1 truncate">
                      <span
                        className={s.needsYou ? 'font-medium text-attn' : ''}
                      >
                        {s.label}
                      </span>{' '}
                      {c.customer && ` · ${c.customer}`}
                    </span>
                    {draft && <span className="flex-none">Draft</span>}
                    {c.example && <span className="flex-none">Example</span>}
                    {c.questionsForYou > 0 && (
                      <span
                        title={`${c.questionsForYou} open question for you`}
                        className="inline-grid h-4 min-w-4 place-items-center rounded-full bg-ink px-[5px] text-[10px] font-semibold text-on-ink"
                      >
                        {c.questionsForYou}
                      </span>
                    )}
                    <Avatar
                      name={localOwnerName || c.doc.ownerName || owner.name}
                      tone={owner.tone}
                    />
                  </span>
                </button>
              </SidebarItem>
            );
          })}
          {found.length === 0 && (
            <p className="px-2 py-3 text-meta text-ink-3">
              {q
                ? `No cases match “${query}” in ${filter}.`
                : filter === 'Mine'
                  ? 'No cases owned by you.'
                  : filter === 'Contributing'
                    ? 'No cases you’re contributing to.'
                    : 'No cases yet.'}
            </p>
          )}
          {!showAllCases && found.length > VISIBLE_CASES && (
            <button
              type="button"
              onClick={() => setShowAllCases(true)}
              className={`${row} text-ink-3 hover:bg-hover`}
            >
              Show all
            </button>
          )}
        </div>
      </section>

      <div className="mb-1.5 h-px flex-none bg-line" />

      <section
        className="flex flex-none flex-col px-2 pt-0.5 pb-2"
        aria-label="Playbooks"
      >
        <h2 className="flex h-[26px] items-center px-2 text-meta font-normal text-ink-3">
          Playbooks
        </h2>
        {onNewPlaybook && (
          <button
            type="button"
            className={`${row} ${rowState(false)} cursor-pointer active:bg-hover disabled:cursor-wait disabled:opacity-60`}
            onClick={onNewPlaybook}
            disabled={creatingPlaybook || playbookBusy}
          >
            <span className="text-ink-2">
              <Icon name="edit" />
            </span>
            {creatingPlaybook ? 'Creating Playbook…' : 'New Playbook'}
          </button>
        )}
        {createPlaybookError && (
          <p role="alert" className="px-2 text-meta text-ink-3">
            Could not create Playbook. Please try again.
          </p>
        )}
        <div
          className={showAllPlaybooks ? 'max-h-40 overflow-y-auto' : undefined}
        >
          {playbooks
            .slice(0, showAllPlaybooks ? undefined : RECENT_PLAYBOOKS)
            .map((p) => (
              <SidebarItem
                key={p.id}
                value={p.title}
                selected={openPlaybook === p.id}
                {...itemActions('playbook', p.id)}
              >
                <button
                  type="button"
                  onClick={() => onOpenPlaybook(p.id)}
                  title={draftPlaybookIds?.has(p.id) ? 'Draft' : undefined}
                  className={`${row} flex-1 ${draftPlaybookIds?.has(p.id) ? 'text-ink-3' : ''}`}
                >
                  <span className="truncate">{p.title}</span>
                </button>
              </SidebarItem>
            ))}
        </div>
        {playbooks.length > RECENT_PLAYBOOKS && (
          <button
            type="button"
            aria-expanded={showAllPlaybooks}
            onClick={() => setShowAllPlaybooks(!showAllPlaybooks)}
            className={`${row} text-ink-3 hover:bg-hover`}
          >
            {showAllPlaybooks ? 'Show fewer' : 'Show all'}
          </button>
        )}
      </section>

      <footer className="flex h-12 flex-none items-center gap-1 pr-2.5 pl-3">
        <button
          type="button"
          title="Account"
          aria-haspopup="menu"
          aria-expanded={menu}
          data-menu-anchor
          onClick={() => setMenu(!menu)}
          className={`flex items-center gap-1 rounded-full p-0.5 text-ink-3 hover:bg-hover ${menu ? 'bg-hover' : ''}`}
        >
          <Avatar
            name={
              account.view?.account.name ||
              account.view?.account.email ||
              'Personal'
            }
            size={22}
          />
          <Icon name="down" size={12} />
        </button>
        <span className="flex-1" />
        {updateReady && (
          <button
            type="button"
            title="Open settings to restart and update"
            onClick={() => onOpenSettings('general')}
            className="rounded-full bg-sunk px-2 py-0.5 text-meta font-medium text-ink-2 hover:bg-hover"
          >
            Update ready
          </button>
        )}
        {syncStatus}
        <SidebarSearch
          chats={chats}
          cases={cases}
          playbooks={playbooks}
          onOpenChat={onOpenChat}
          onOpenCase={onOpenCase}
          onOpenPlaybook={onOpenPlaybook}
        />
      </footer>
      {menu && (
        <AccountMenu
          onContextChange={onContextChange}
          onClose={closeMenu}
          onSettings={() => onOpenSettings('general')}
          onAccount={() => onOpenSettings('account')}
          onShortcuts={() => onOpenSettings('general')}
          onQuickTour={onQuickTour}
        />
      )}
    </aside>
  );
}

export type { View };
