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
const person = (id: string) => (id === 'local' ? 'You' : 'Local contributor');

// Real exports read the checked record in main; preview formatting stays in renderer.
export function storedCaseMarkdown(c: CaseRecord): string {
  const out = [`# Case #${c.number} · ${line(c.title)}`, ''];
  const field = (key: string, text: string) =>
    out.push(`- **${key}:** ${line(text)}`);
  field('Status', statuses[c.status]);
  field('Owner', c.ownerName ?? person(c.ownerId));
  if (c.contributorIds?.length)
    field('Contributors', c.contributorIds.join(', '));
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
      if (entry.recipientId) out.push(`- **For:** ${line(entry.recipientId)}`);
      if (entry.answer)
        out.push(
          `- **Answer:** ${line(entry.answer)} _(${line(entry.answeredBy ?? 'Teammate')})_`,
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
        out.push(`- **${line(pill)}:** ${description} _(${author})_`);
      }
    }
  });
  return out.join('\n') + '\n';
}
