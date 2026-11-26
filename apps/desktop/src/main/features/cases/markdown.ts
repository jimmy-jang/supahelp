import type { CaseRecord } from '../../../contracts/cases';

const sections = [
  ['summary', 'Summary'],
  ['customer', 'Customer'],
  ['problem', 'Problem'],
  ['reproduction', 'Reproduction'],
  ['findings', 'Findings'],
  ['actions', 'Actions'],
  ['questions', 'Open questions'],
  ['next', 'Next step'],
  ['resolution', 'Resolution'],
] as const;
const statuses = {
  inv: 'Investigating',
  run: 'Running',
  appr: 'Needs approval',
  unk: 'Outcome unknown',
  wcust: 'Waiting on customer',
  weng: 'Waiting on engineering',
  done: 'Resolved',
  fail: 'Failed',
};
const line = (text: string) =>
  text
    .replace(/\s*\n\s*/g, ' ')
    .trim()
    .replace(/[\\`*_{}[\]<>#|]/g, '\\$&');
// Real exports read the checked record in main; preview formatting stays in renderer.
export function storedCaseMarkdown(
  c: CaseRecord,
  people: readonly { id: string; name: string }[] = [],
): string {
  const name = (id: string) => people.find((p) => p.id === id)?.name;
  const person = (id: string) =>
    name(id) ??
    (id === 'local'
      ? 'You'
      : c.workspaceId === 'personal'
        ? 'Local contributor'
        : 'Teammate');
  const out = [`# Case #${c.number} · ${line(c.title)}`, ''];
  const field = (key: string, text: string) =>
    out.push(`- **${key}:** ${line(text)}`);
  field('Status', statuses[c.status]);
  field('Owner', name(c.ownerId) ?? c.ownerName ?? person(c.ownerId));
  if (c.contributorIds?.length)
    field('Contributors', c.contributorIds.map(person).join(', '));
  field(
    'Customer',
    `${c.customer.name || 'Not set'}${c.customer.reference ? ` · ${c.customer.reference}` : ''} (${c.customer.confirmed ? 'Confirmed' : 'Unconfirmed'})`,
  );
  field('Ticket', [c.ticket, c.issue].filter(Boolean).join(' · '));
  field('Updated', c.updatedAt);
  sections.forEach(([key, title], i) => {
    const entries = c.entries.filter((entry) => entry.section === key);
    if (!entries.length) return;
    out.push('', `## ${i + 1}. ${title}`, '');
    for (const entry of entries) {
      if (entry.recipientId)
        out.push(`- **For:** ${line(person(entry.recipientId))}`);
      if (entry.answer)
        out.push(
          `- **Answer:** ${line(entry.answer)} _(${line(entry.answeredBy ? person(entry.answeredBy) : 'Teammate')})_`,
        );
      const description = `${line(entry.text)}${entry.detail ? ` — ${line(entry.detail)}` : ''}`;
      if (entry.kind === 'text') out.push(description);
      else if (entry.kind === 'row')
        out.push(`- **${line(entry.label ?? '')}:** ${description}`);
      else {
        const pill =
          key === 'actions' && !entry.systemOwned && entry.pill !== 'Proposed'
            ? 'Unverified'
            : (entry.pill ?? '');
        const author = entry.onBehalfOf
          ? `AI for ${person(entry.onBehalfOf)}`
          : person(entry.authorId);
        out.push(`- **${line(pill)}:** ${description} _(${line(author)})_`);
      }
    }
  });
  return out.join('\n') + '\n';
}
