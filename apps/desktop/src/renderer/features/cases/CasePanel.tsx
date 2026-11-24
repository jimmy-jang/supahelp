import { useEffect, useState, type ReactNode } from 'react';
import { sharedCaseLink } from '../../../contracts/case-links';
import type { CaseEntry, CaseRecord } from '../../../contracts/cases';
import type { PlaybookRecord } from '../../../contracts/playbooks';
import { Avatar } from '../../components/Avatar';
import { DocPanel, DocSection } from '../../components/DocPanel';
import { Icon } from '../../components/Icon';
import { InlineTitle } from '../../components/InlineTitle';
import { menuRow, Popover } from '../../components/Popover';
import { member, members } from '../../fixtures/team';
import { useAccount } from '../accounts/AccountProvider';
import { QuestionControls } from '../collaboration/QuestionControls';
import { caseMarkdown, SECTIONS, sectionTitle } from './caseDoc';
import { CaseEntryEditor } from './CaseEntryEditor';
import { CaseLookup } from './CaseLookup';
import { STATUS } from './status';
import { StatusPill } from './StatusPill';
import { caseLink, type Case, type Entry, type SectionKey } from './types';
import type { useCases } from './useCases';
import { useCustomers } from './useCustomers';

// The case document beside the chat. Nothing runs from here: approvals stay
// in the chat's approval card (DESIGN.md Do's and Don'ts).
export function CasePanel({
  kase,
  playbookTitle,
  createdPlaybook,
  focus,
  expanded,
  onExpand,
  onClose,
  onBringIn,
  onHandOff,
  onOpenPlaybook,
  onOpenCase,
  caseLookup,
  playbookLookup,
  onCopyMarkdown,
  record,
  actions,
  seenBefore,
  draftResolution,
  resolveControls,
}: {
  kase: Case;
  playbookTitle?: string;
  createdPlaybook?: PlaybookRecord;
  focus?: { section: SectionKey; token: number };
  expanded: boolean;
  onExpand: () => void;
  onClose: () => void;
  onBringIn?: (memberId: string) => void;
  onHandOff?: (memberId: string) => void;
  onOpenPlaybook: (id: string) => void;
  onOpenCase: (id: string) => void;
  caseLookup: Case[];
  playbookLookup: { id: string; title: string; detail?: string }[];
  onCopyMarkdown?: () => Promise<string | undefined>;
  record?: CaseRecord;
  actions?: ReturnType<typeof useCases>;
  seenBefore?: ReactNode;
  // Saved but unconfirmed Resolve draft; shown until Confirm Resolve writes it.
  draftResolution?: string;
  resolveControls?: ReactNode;
}) {
  const d = kase.doc;
  const collaboration = actions?.collaboration;
  const shared = !!record && record.workspaceId !== 'personal';
  const canEdit = !shared || !!collaboration?.canEdit;
  const people = shared
    ? (collaboration?.value?.members ?? [])
    : (actions?.people ?? (kase.example ? members : []));
  const ownerControls =
    shared &&
    record.ownerId === collaboration?.accountId &&
    collaboration.value &&
    !collaboration.busy;
  const bring = ownerControls
    ? (id: string) =>
        void collaboration.command({
          caseId: record.id,
          type: 'bring-in',
          recipientId: id,
          ownerRevision: record.ownerRevision ?? 0,
        })
    : onBringIn;
  const handoff = ownerControls
    ? (id: string) =>
        void collaboration.command({
          caseId: record.id,
          type: 'handoff',
          recipientId: id,
          ownerRevision: record.ownerRevision ?? 0,
        })
    : onHandOff;
  const myName = useAccount().snapshot.view?.account.name;
  // The local person is stored as "You"; show the account name instead.
  const named = <T extends { id: string; name: string }>(p: T): T =>
    p.id === 'local' && myName ? { ...p, name: myName } : p;
  const person = (id: string) =>
    named(
      (shared ? collaboration?.value?.members : actions?.people)?.find(
        (p) => p.id === id,
      ) ?? member(id),
    );
  const bringIn = shared
    ? bring
    : (onBringIn ??
      (record && actions
        ? (id: string) =>
            void actions.assign(
              record.id,
              'bring-in',
              id,
              record.ownerRevision ?? 0,
            )
        : undefined));
  const handOff = shared ? handoff : onHandOff;
  const [copied, setCopied] = useState<string>();
  // Sections added with "+ Add section" (preview only; not saved).
  const [added, setAdded] = useState<SectionKey[]>([]);
  const [editor, setEditor] = useState<{
    section: SectionKey;
    entry?: CaseEntry;
  }>();

  useEffect(() => {
    if (!focus) return;
    const target = document.getElementById(`case-sec-${focus.section}`);
    if (target) {
      target.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'instant'
          : 'smooth',
        block: 'start',
      });
      target.tabIndex = -1;
      target.focus({ preventScroll: true });
    }
  }, [focus]);

  const copy = (text: string, done: string) =>
    navigator.clipboard.writeText(text).then(
      () => setCopied(done),
      () => setCopied('Couldn’t copy'),
    );
  const copyMarkdown = async () => {
    try {
      const text = kase.example
        ? caseMarkdown(kase, {
            status: STATUS[kase.status].label,
            person: (id) => `${member(id).name} (${member(id).role})`,
            playbook: playbookTitle,
          })
        : await onCopyMarkdown?.();
      if (text === undefined) setCopied('Couldn’t copy');
      else await copy(text, 'Copied');
    } catch {
      setCopied('Couldn’t copy');
    }
  };
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(undefined), 1600);
    return () => clearTimeout(t);
  }, [copied]);

  const owner =
    record && record.workspaceId !== 'personal'
      ? {
          id: record.ownerId,
          name: record.ownerName ?? 'Teammate',
          role: person(record.ownerId).role,
        }
      : person(d.ownerId);
  const customers = useCustomers(record?.workspaceId === 'personal');
  const customerId = customers.directory.links.find(
    (link) => link.caseId === kase.id,
  )?.customerId;
  const selectedCustomer = customers.directory.customers.find(
    (customer) => customer.id === customerId,
  );
  const createdTitle = (createdPlaybook?.draft ?? createdPlaybook?.published)
    ?.title;
  const casePlaybooks = [
    ...(d.playbook && playbookTitle
      ? [{ id: d.playbook.id, title: playbookTitle, detail: d.playbook.state }]
      : []),
    ...(createdPlaybook && createdTitle && createdPlaybook.id !== d.playbook?.id
      ? [
          {
            id: createdPlaybook.id,
            title: createdTitle,
            detail: createdPlaybook.draft
              ? 'Draft · Created from case'
              : 'Created from case',
          },
        ]
      : []),
  ];
  const updatedAt = record
    ? new Date(record.updatedAt).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : '';
  const shown = (k: SectionKey) =>
    !!d.sections[k] ||
    added.includes(k) ||
    k === focus?.section ||
    (k === 'resolution' && !!draftResolution);
  const empty = SECTIONS.filter(([k]) => !shown(k)).map(([k]) => k);
  const fresh = (id: string) => d.fresh.includes(id);

  return (
    <DocPanel
      label={`Case #${kase.number}`}
      expanded={expanded}
      onExpand={onExpand}
      onClose={onClose}
      header={
        <>
          <span className="text-ink-2">
            <Icon name="doc" />
          </span>
          <b className="font-medium">Case #{kase.number}</b>
          {kase.example && (
            <span className="text-[11px] text-ink-3">Example</span>
          )}
          <span className="inline-flex items-center gap-1 text-[11px] text-ink-3">
            <span
              className={`size-1.5 rounded-full ${d.sync === 'Synced' ? 'bg-ok' : 'bg-ink-3'}`}
            />
            {d.sync}
          </span>
        </>
      }
      actions={
        <>
          {copied && (
            <span role="status" className="text-meta text-ink-3">
              {copied}
            </span>
          )}
          <Popover
            title="More"
            area="bottom span-left"
            className="w-[200px]"
            buttonClass="no-drag grid size-7 place-items-center rounded-[7px] text-ink-2 hover:bg-hover"
            label={<Icon name="more" />}
          >
            <button
              type="button"
              className={menuRow}
              title="Copy as Markdown for any AI agent"
              onClick={() => void copyMarkdown()}
            >
              <Icon name="md" size={15} />
              Copy as Markdown
            </button>
            <button
              type="button"
              className={menuRow}
              onClick={() =>
                void copy(
                  shared ? sharedCaseLink(record!.id) : caseLink(kase.number),
                  'Link copied',
                )
              }
            >
              <Icon name="link" size={15} />
              Copy case link
            </button>
          </Popover>
        </>
      }
    >
      {shared && collaboration?.error && (
        <p role="alert" className="text-meta text-bad">
          {collaboration.error}
        </p>
      )}
      <h1 className="m-0 mt-1.5 mb-3 text-heading font-semibold tracking-[-0.01em]">
        {record && actions && canEdit ? (
          <InlineTitle
            label="Case title"
            value={record.title}
            onSave={(title, expectedTitle) =>
              actions.rename(record.id, title, expectedTitle)
            }
          />
        ) : (
          kase.title
        )}
      </h1>

      {customers.error && record?.workspaceId === 'personal' && (
        <p role="alert" className="text-meta text-bad">
          {customers.error}{' '}
          <button type="button" className="underline" onClick={customers.retry}>
            Refresh customers
          </button>
        </p>
      )}
      {actions?.error && (
        <p role="alert" className="text-meta text-bad">
          {actions.error}
        </p>
      )}
      <dl className="m-0 mb-1.5 grid grid-cols-[96px_1fr] gap-x-3 gap-y-1.5 border-b border-line pb-4">
        <Field label="Status">
          <CaseLookup
            property="Status"
            value={<StatusPill status={kase.status} />}
            items={[
              {
                id: kase.status,
                search: STATUS[kase.status].label,
                content: (
                  <>
                    <StatusPill status={kase.status} />
                    <span className="text-meta text-ink-3">Current status</span>
                  </>
                ),
              },
              // Running, Needs approval, Outcome unknown and Failed follow the
              // chat and its actions; Resolved goes through Resolve. Personal
              // only until team status syncs.
              ...(actions && !shared && kase.status !== 'done'
                ? (['inv', 'wcust', 'weng'] as const)
                    .filter((s) => s !== kase.status)
                    .map((s) => ({
                      id: s,
                      search: STATUS[s].label,
                      content: <StatusPill status={s} />,
                      select: () => void actions.setStatus(kase.id, s),
                    }))
                : []),
            ]}
          />
        </Field>
        <Field label="Owner">
          <CaseLookup
            property="Owner"
            value={<PersonValue person={owner} />}
            items={[
              personItem(owner, 'Current owner'),
              ...(handOff && !actions?.assigning
                ? people
                    .filter((p) => p.id !== owner.id && p.role !== 'viewer')
                    .map((p) =>
                      personItem(named(p), 'Make owner', () => handOff(p.id)),
                    )
                : []),
            ]}
          />
        </Field>
        <Field label="Contributors">
          <CaseLookup
            property="Contributors"
            value={
              d.contributorIds.length ? (
                d.contributorIds.map((id) => (
                  <PersonValue key={id} person={person(id)} />
                ))
              ) : (
                <span className="text-ink-3">None yet</span>
              )
            }
            items={[
              ...d.contributorIds.map((id) =>
                personItem(person(id), 'Contributor'),
              ),
              ...(bringIn && !actions?.assigning
                ? people
                    .filter(
                      (p) =>
                        p.role !== 'viewer' &&
                        !d.contributorIds.includes(p.id) &&
                        (record?.workspaceId === 'personal' ||
                          p.id !== owner.id),
                    )
                    .map((p) =>
                      personItem(named(p), 'Add', () => bringIn(p.id)),
                    )
                : []),
            ]}
            empty="No contributors available."
          />
        </Field>
        <Field label="Customer">
          <CustomerValue
            customer={
              selectedCustomer ?? {
                name: d.customer.name,
                reference: d.customer.id,
              }
            }
          />
          {!selectedCustomer && d.customer.confirmed && (
            <span className="inline-flex items-center gap-1 text-meta text-ok">
              <Icon name="check" size={13} /> Confirmed
            </span>
          )}
        </Field>
        <Field label="Ticket">
          <CaseLookup
            property="Ticket"
            value={
              kase.ticket || d.issue ? (
                <Mono>
                  {[kase.ticket, d.issue].filter(Boolean).join(' · ')}
                </Mono>
              ) : (
                <span className="text-ink-3">None yet</span>
              )
            }
            items={[kase, ...caseLookup.filter((c) => c.id !== kase.id)]
              .filter((c) => c.ticket || c.doc.issue)
              .map((c) => {
                const reference = [c.ticket, c.doc.issue]
                  .filter(Boolean)
                  .join(' · ');
                return {
                  id: c.id,
                  search: `${reference} ${c.title}`,
                  content: (
                    <>
                      <Mono>{reference}</Mono>
                      <span className="truncate text-meta text-ink-3">
                        {c.title}
                      </span>
                    </>
                  ),
                  select: c.id === kase.id ? undefined : () => onOpenCase(c.id),
                };
              })}
            empty="No ticket references in this workspace."
          />
        </Field>
        <Field label="Playbook">
          <CaseLookup
            property="Playbook"
            value={
              casePlaybooks.length ? (
                casePlaybooks.map((book) => (
                  <span
                    key={book.id}
                    className="inline-flex min-w-0 flex-wrap items-center gap-1.5"
                  >
                    <Icon name="book" size={14} />
                    <span className="truncate">{book.title}</span>
                    <span className="text-meta text-ink-3">{book.detail}</span>
                  </span>
                ))
              ) : (
                <span className="text-ink-3">None yet</span>
              )
            }
            items={[
              ...casePlaybooks,
              ...playbookLookup.filter(
                (book) =>
                  !casePlaybooks.some((linked) => linked.id === book.id),
              ),
            ].map((book) => ({
              id: book.id,
              search: book.title,
              content: (
                <>
                  <Icon name="book" size={14} />
                  <span className="truncate">{book.title}</span>
                  {book.detail && (
                    <span className="shrink-0 text-meta text-ink-3">
                      {book.detail}
                    </span>
                  )}
                </>
              ),
              select: () => onOpenPlaybook(book.id),
            }))}
            empty="No Playbooks available."
          />
        </Field>
        <Field label="Updated">
          <span className="text-meta text-ink-2">{updatedAt || d.updated}</span>
        </Field>
      </dl>
      {resolveControls}

      {SECTIONS.map(([key, title], i) => {
        const s = d.sections[key];
        if (!shown(key)) return null;
        return (
          <DocSection key={key} id={`case-sec-${key}`} n={i + 1} title={title}>
            {record && actions ? (
              <>
                {record.entries
                  .filter((e) => e.section === key)
                  .map((e) => (
                    <div
                      key={e.id}
                      className={`mb-2 rounded-item p-2 ${fresh(e.id) || fresh(key) ? 'bg-sunk' : ''}`}
                    >
                      {e.kind === 'item' ? (
                        <EntryRow
                          e={{
                            id: e.id,
                            text: e.text,
                            detail: e.detail,
                            pill:
                              key === 'actions' &&
                              !e.systemOwned &&
                              e.pill !== 'Proposed'
                                ? 'Unverified'
                                : (e.pill ?? ''),
                            by: e.onBehalfOf
                              ? 'AI'
                              : e.authorId === 'local'
                                ? 'You'
                                : (e.authorName ?? person(e.authorId).name),
                          }}
                          mono={key === 'findings'}
                          fresh={false}
                        />
                      ) : e.kind === 'row' ? (
                        <dl className="m-0 grid grid-cols-[96px_1fr] gap-x-3">
                          <dt className="text-meta text-ink-3">{e.label}</dt>
                          <dd className="m-0 whitespace-pre-wrap">{e.text}</dd>
                        </dl>
                      ) : (
                        <p className="m-0 whitespace-pre-wrap">{e.text}</p>
                      )}
                      {shared && key === 'questions' && collaboration && (
                        <QuestionControls
                          caseId={record.id}
                          entry={e}
                          collaboration={collaboration}
                        />
                      )}
                      <div className="mt-1 flex items-center gap-2 text-meta text-ink-3">
                        {e.kind !== 'item' && e.detail && (
                          <span>{e.detail}</span>
                        )}
                        {e.kind !== 'item' && (
                          <span>
                            {e.onBehalfOf
                              ? 'AI'
                              : e.authorId === 'local'
                                ? 'You'
                                : (e.authorName ?? e.authorId)}
                          </span>
                        )}
                        {canEdit &&
                          !e.systemOwned &&
                          key !== 'resolution' &&
                          !(key === 'actions' && e.pill !== 'Proposed') && (
                            <button
                              type="button"
                              aria-label={`Edit entry ${e.id}`}
                              className="rounded-chip px-1 text-ink-2 hover:bg-hover"
                              onClick={() =>
                                setEditor({ section: key, entry: e })
                              }
                            >
                              Edit
                            </button>
                          )}
                        {e.systemOwned && key !== 'resolution' && (
                          <span>Protected result</span>
                        )}
                      </div>
                    </div>
                  ))}
                {key === 'resolution' && draftResolution && (
                  <div className="mb-2 rounded-item bg-sunk p-2">
                    <p className="m-0 whitespace-pre-wrap">{draftResolution}</p>
                    <div className="mt-1 text-meta text-ink-3">
                      Draft · Confirm Resolve above to add it to the case.
                    </div>
                  </div>
                )}
                {canEdit && key !== 'resolution' && (
                  <button
                    type="button"
                    aria-label={`Add entry to ${title}`}
                    className="inline-flex items-center gap-1 rounded-item px-2 py-1 text-meta text-ink-2 hover:bg-hover"
                    onClick={() => setEditor({ section: key })}
                  >
                    <Icon name="plus" size={13} /> Add entry
                  </button>
                )}
              </>
            ) : (
              <>
                {!s && (
                  <p className="m-0 text-ink-3">
                    {kase.example
                      ? 'Empty. Ask the AI in the chat to fill it in.'
                      : 'Empty for now.'}
                  </p>
                )}
                {s?.text && (
                  <p
                    className={`m-0 mb-1 rounded-item ${fresh(key) ? '-mx-2 bg-sunk px-2 py-1.5' : ''}`}
                  >
                    {s.text}
                  </p>
                )}
                {s?.rows && (
                  <dl
                    className={`m-0 grid grid-cols-[96px_1fr] gap-x-3 gap-y-[3px] rounded-item ${fresh(key) ? '-mx-2 bg-sunk px-2 py-1.5' : ''}`}
                  >
                    {s.rows.map(([k, v]) => (
                      <div key={k} className="contents">
                        <dt className="text-meta text-ink-3">{k}</dt>
                        <dd className="m-0">{v}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                {s?.entries?.map((e) => (
                  <EntryRow
                    key={e.id}
                    e={e}
                    mono={key === 'findings'}
                    fresh={fresh(e.id) || fresh(key)}
                  />
                ))}
              </>
            )}
          </DocSection>
        );
      })}

      {empty.length > 0 && (
        <div className="flex items-center gap-1.5 pt-3 text-meta text-ink-3">
          <Icon name="doc" size={13} />
          <span className="min-w-0 flex-1">
            {listed(empty.map(sectionTitle))}{' '}
            {empty.length > 1 ? 'are empty, so they’re' : 'is empty, so it’s'}{' '}
            hidden.
          </span>
          <Popover
            title="Add section"
            area="bottom span-left"
            className="w-[200px]"
            buttonClass="inline-flex items-center gap-1 rounded-chip px-2 py-[3px] text-ink-2 hover:bg-hover"
            label={
              <>
                <Icon name="plus" size={13} />
                Add section
              </>
            }
          >
            {empty
              .filter((k) => !record || k !== 'resolution')
              .map((k) => (
                <button
                  key={k}
                  type="button"
                  className={menuRow}
                  aria-label={`Add entry to ${sectionTitle(k)}`}
                  onClick={() =>
                    record
                      ? setEditor({ section: k })
                      : setAdded((a) => [...a, k])
                  }
                >
                  {sectionTitle(k)}
                </button>
              ))}
          </Popover>
        </div>
      )}

      {seenBefore}
      {d.similar.length > 0 && (
        <DocSection title="Similar cases">
          <div className="flex flex-col gap-0.5">
            {d.similar.map((s) => (
              <button
                key={s.title}
                type="button"
                className="-mx-2 grid grid-cols-[auto_1fr_auto] items-start gap-2.5 rounded-item px-2 py-[7px] text-left hover:bg-hover"
              >
                <StatusPill status="done" />
                <span>
                  {s.title}
                  <span className="block text-meta text-ink-3">{s.note}</span>
                </span>
                <span className="text-[11px] text-ink-3">{s.by}</span>
              </button>
            ))}
          </div>
        </DocSection>
      )}

      <details className="pt-[18px] [&_summary::-webkit-details-marker]:hidden">
        <summary className="flex list-none items-center gap-2 text-body font-semibold">
          <span className="text-ink-2">
            <Icon name="history" size={14} />
          </span>
          Change log
          <span className="text-meta font-normal text-ink-3">
            · {d.log.length} change{d.log.length === 1 ? '' : 's'}
          </span>
        </summary>
        <div className="mt-2 flex flex-col gap-1 text-meta text-ink-3">
          {d.log.map((l, i) => (
            <div key={l.changeId ?? i} className="flex flex-wrap gap-2">
              <Mono>{l.time}</Mono>
              <span>
                {record?.changes.find((c) => c.id === l.changeId)?.conflict
                  ? `Conflict · ${l.text}`
                  : l.text}
              </span>
              {record &&
                actions &&
                (() => {
                  const c = record.changes.find((c) => c.id === l.changeId);
                  if (!c) return null;
                  const entry = record.entries.find((e) => e.id === c.entryId);
                  const section = (c.after ?? c.before)?.section;
                  if (section === 'resolution' || entry?.systemOwned)
                    return null;
                  const note =
                    actions.undoNotes[c.id] ??
                    (c.undoneAt ? 'Undone' : undefined);
                  return (
                    <>
                      <button
                        type="button"
                        aria-label={`Undo change ${c.id}`}
                        disabled={!!c.undoneAt || actions.undoing.has(c.id)}
                        className="rounded-chip px-1 text-ink-2 hover:bg-hover disabled:opacity-40"
                        onClick={() => void actions.undo(record.id, c.id)}
                      >
                        Undo change
                      </button>
                      {note && <span role="status">{note}</span>}
                    </>
                  );
                })()}
            </div>
          ))}
        </div>
      </details>
      {record && actions && editor && (
        <CaseEntryEditor
          record={record}
          section={editor.section}
          entry={editor.entry}
          actions={actions}
          onClose={() => setEditor(undefined)}
        />
      )}
    </DocPanel>
  );
}

const listed = (xs: string[]) =>
  xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}` : xs[0];

type Person = { id: string; name: string; role: string; tone?: string };

function PersonValue({ person }: { person: Person }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <Avatar name={person.name} tone={person.tone} />
      <span className="truncate">{person.name}</span>
    </span>
  );
}

function personItem(person: Person, label: string, select?: () => void) {
  return {
    id: person.id,
    search: `${person.name} ${person.role} ${label}`,
    content: (
      <>
        <PersonValue person={person} />
        <span className="ml-auto shrink-0 text-meta text-ink-3">{label}</span>
      </>
    ),
    select,
  };
}

function CustomerValue({
  customer,
}: {
  customer: { name: string; reference?: string };
}) {
  return (
    <>
      {customer.name && (
        <span className="min-w-0 truncate">{customer.name}</span>
      )}
      {customer.reference && <Mono>{customer.reference}</Mono>}
      {!customer.name && !customer.reference && (
        <span className="text-ink-3">Not set</span>
      )}
    </>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="pt-px text-meta text-ink-3">{label}</dt>
      <dd className="m-0 flex min-w-0 flex-wrap items-center gap-1.5">
        {children}
      </dd>
    </>
  );
}

function Mono({ children }: { children: ReactNode }) {
  return (
    <span className="min-w-0 max-w-full truncate font-mono text-[11.5px] tabular-nums">
      {children}
    </span>
  );
}

const PILL: Record<string, string> = {
  Confirmed: 'bg-ok-soft text-ok',
  Verified: 'bg-ok-soft text-ok',
  Guess: 'text-ink-2 ring-1 ring-inset ring-line',
};

// Finding / action / question row: verdict pill, text, evidence, who added it.
function EntryRow({
  e,
  mono,
  fresh,
}: {
  e: Entry;
  mono: boolean;
  fresh: boolean;
}) {
  return (
    <div
      className={`-mx-2 grid grid-cols-[86px_minmax(0,1fr)_auto] items-start gap-2.5 rounded-item px-2 py-[7px] ${fresh ? 'bg-sunk' : ''}`}
    >
      <span
        className={`inline-flex justify-center rounded-full px-2 py-px text-[11px] font-medium whitespace-nowrap ${PILL[e.pill] ?? 'bg-sunk text-ink-2'}`}
      >
        {e.pill}
      </span>
      <div className="min-w-0">
        {e.text}
        {e.detail && (
          <div
            className={`mt-px text-ink-3 ${mono ? 'font-mono text-[11.5px] tabular-nums' : 'text-meta'}`}
          >
            {e.detail}
          </div>
        )}
      </div>
      <span className="text-[11px] text-ink-3">{e.by}</span>
    </div>
  );
}
