// Pure case-document helpers: section order, undoable edits and Markdown.
// Type-only imports so Node's test runner can load this file directly.
import type { CaseRecord } from '../../../contracts/cases';
import type {
  Case,
  CaseDoc,
  Change,
  Entry,
  Section,
  SectionKey,
} from './types';

export const SECTIONS: [SectionKey, string][] = [
  ['summary', 'Summary'],
  ['customer', 'Customer'],
  ['problem', 'Problem'],
  ['reproduction', 'Reproduction'],
  ['findings', 'Findings'],
  ['actions', 'Actions'],
  ['questions', 'Open questions'],
  ['next', 'Next step'],
  ['resolution', 'Resolution'],
];

export const sectionTitle = (key: SectionKey) =>
  SECTIONS.find(([k]) => k === key)![1];

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

function current(doc: CaseDoc, c: Change) {
  const section = doc.sections[c.section];
  return c.entryId
    ? section?.entries?.find((e) => e.id === c.entryId)
    : section;
}

function put(doc: CaseDoc, c: Change, value: Entry | Section | undefined) {
  const sections = { ...doc.sections };
  if (c.entryId) {
    const entries = sections[c.section]?.entries ?? [];
    const next = entries.some((e) => e.id === c.entryId)
      ? entries.flatMap((e) =>
          e.id === c.entryId ? (value ? [value as Entry] : []) : [e],
        )
      : value
        ? [...entries, value as Entry]
        : entries;
    sections[c.section] = { ...sections[c.section], entries: next };
  } else if (value) sections[c.section] = value as Section;
  else delete sections[c.section];
  return { ...doc, sections };
}

export const applyChange = (doc: CaseDoc, c: Change) => put(doc, c, c.after);

// Undo reverts that one entry, unless it has changed since (brief: Editing rules).
export function undoChange(
  doc: CaseDoc,
  c: Change,
): { doc: CaseDoc } | { error: string } {
  if (!same(current(doc, c), c.after))
    return { error: 'Changed since. Edit it instead.' };
  return { doc: put(doc, c, c.before) };
}

const line = (s: string) => s.replace(/\s*\n\s*/g, ' ').trim();

// "Copy as Markdown": same headings and numbers as the panel.
export function caseMarkdown(
  c: {
    number: number;
    title: string;
    ticket: string;
    doc: CaseDoc;
  },
  extra: {
    status: string;
    person: (id: string) => string;
    playbook?: string;
  },
) {
  const d = c.doc;
  const out = [`# Case #${c.number} · ${line(c.title)}`, ''];
  const field = (k: string, v: string) => out.push(`- **${k}:** ${line(v)}`);
  field('Status', extra.status);
  field('Owner', extra.person(d.ownerId));
  field('Contributors', d.contributorIds.map(extra.person).join(', ') || '—');
  field(
    'Customer',
    `${d.customer.name || 'Not set'}${d.customer.id ? ` · \`${d.customer.id}\`` : ''} (${d.customer.confirmed ? 'Confirmed' : 'Unconfirmed'})`,
  );
  field(
    'Ticket',
    [c.ticket, d.issue]
      .filter(Boolean)
      .map((t) => `\`${t}\``)
      .join(' · '),
  );
  if (extra.playbook)
    field(
      'Playbook',
      `${extra.playbook} (${d.playbook?.state ?? 'suggested'})`,
    );
  field('Updated', d.updated);

  SECTIONS.forEach(([key, title], i) => {
    const s = d.sections[key];
    if (!s) return;
    out.push('', `## ${i + 1}. ${title}`, '');
    if (s.text) out.push(line(s.text));
    for (const [k, v] of s.rows ?? []) out.push(`- **${k}:** ${line(v)}`);
    for (const e of s.entries ?? [])
      out.push(
        `- **${e.pill}:** ${line(e.text)}${e.detail ? ` — ${line(e.detail)}` : ''} _(${e.by})_`,
      );
  });

  if (d.similar.length) {
    out.push('', '## Similar cases', '');
    for (const s of d.similar)
      out.push(`- ${line(s.title)} — ${line(s.note)} _(${s.by})_`);
  }
  return `${out.join('\n')}\n`;
}

// Whether a chat looks like a customer support request (offers Create case).
export const looksLikeTicket = (t: string) =>
  /zendesk|intercom|ticket|#\d{3,}/i.test(t);

const clock = (iso: string) => {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString([], { day: 'numeric', month: 'short' });
};

// A stored case, shaped for the case panel, sidebar and Markdown.
export function toCase(
  r: CaseRecord,
  time = clock,
  people: readonly { id: string; name: string }[] = [],
): Case {
  const who = (id: string) =>
    id === 'local'
      ? 'You'
      : (people.find((p) => p.id === id)?.name ??
        r.changes.find((c) => c.by === id)?.byName ??
        (r.ownerId === id ? r.ownerName : undefined) ??
        'Teammate');
  const sections: CaseDoc['sections'] = {};
  for (const e of r.entries) {
    const s = (sections[e.section] ??= {});
    const by = e.onBehalfOf ? 'AI' : (e.authorName ?? who(e.authorId));
    if (e.kind === 'text') s.text = s.text ? `${s.text}\n${e.text}` : e.text;
    else if (e.kind === 'row') (s.rows ??= []).push([e.label ?? '', e.text]);
    else
      (s.entries ??= []).push({
        id: e.id,
        pill:
          e.section === 'actions' && !e.systemOwned && e.pill !== 'Proposed'
            ? 'Unverified'
            : (e.pill ?? ''),
        text: e.text,
        detail: e.detail,
        by,
      });
  }
  const last = r.changes[0];
  return {
    id: r.id,
    number: r.number,
    ticket: r.ticket,
    title: r.title,
    customer: r.customer.name,
    status: r.status,
    time: time(r.updatedAt),
    messages: [],
    chatId: r.chatIds.at(-1),
    doc: {
      ownerId: r.ownerId,
      ownerName: people.find((p) => p.id === r.ownerId)?.name ?? r.ownerName,
      contributorIds: r.contributorIds ?? [],
      customer: {
        name: r.customer.name,
        id: r.customer.reference,
        confirmed: r.customer.confirmed,
      },
      issue: r.issue,
      playbook: r.playbookId ? { id: r.playbookId, state: 'used' } : undefined,
      updated: `${time(r.updatedAt)} · ${r.changes.some((change) => change.undoneAt === r.updatedAt) ? 'You' : last?.onBehalfOf ? 'AI' : who(last?.by ?? r.ownerId)}`,
      sync:
        r.workspaceId === 'personal'
          ? 'On this computer'
          : (r.syncState ?? 'Waiting to sync'),
      sections,
      similar: [],
      log: [
        ...(r.collaborationChanges ?? []).map((c) => ({
          time: time(c.at),
          text: `${who(c.by)} · ${({ 'bring-in': 'Brought in', handoff: 'Handed off', 'assign-question': 'Question assigned' } as Record<string, string>)[c.type] ?? 'Case updated'}${c.recipientId ? ` · ${who(c.recipientId)}` : ''}`,
        })),
        ...r.changes.map((c) => {
          const v = c.after ?? c.before;
          const did = c.undoneAt
            ? 'undone'
            : !c.before
              ? 'added'
              : c.after
                ? 'edited'
                : 'removed';
          return {
            changeId: c.id,
            time: time(c.at),
            text: `${c.onBehalfOf ? 'AI' : (c.byName ?? who(c.by))} · ${v ? sectionTitle(v.section) : ''}: ${did}${v ? ` · ${v.label ? `${v.label}: ` : ''}${v.text}` : ''}`,
          };
        }),
      ],
      fresh:
        last?.onBehalfOf &&
        !last.undoneAt &&
        r.entries.some(
          (entry) =>
            entry.id === last.entryId && entry.version === last.version,
        )
          ? [
              last.entryId,
              ...(last.after && last.after.kind !== 'item'
                ? [last.after.section]
                : []),
            ]
          : [],
    },
    attached: { caseId: r.id, playbookIds: [] },
    questionsForYou: 0,
  };
}
