import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyChange,
  caseMarkdown,
  undoChange,
} from '../src/renderer/features/cases/caseDoc.ts';

const doc = () => ({
  ownerId: 'jimmy',
  contributorIds: ['sam'],
  customer: { name: 'Brightway Studio', id: 'cus_Nf7a', confirmed: true },
  issue: 'Linear ENG-311',
  playbook: { id: 'pb1', state: 'suggested' },
  updated: '9:41 · AI for Jimmy',
  sync: 'Synced',
  sections: {
    summary: { text: 'Charged twice\non renewal.' },
    customer: { rows: [['Account', 'Team plan']] },
    findings: {
      entries: [
        {
          id: 'f1',
          pill: 'Confirmed',
          text: 'Two invoices',
          detail: 'Stripe in_1',
          by: 'Jimmy',
        },
      ],
    },
    next: { text: 'Approve the refund.' },
  },
  similar: [{ title: '#287 · Retry duplicate', note: 'Refunded', by: 'Marco' }],
  log: [],
  fresh: [],
});

const names = { jimmy: 'Jimmy (support)', sam: 'Sam (developer)' };
const md = (d) =>
  caseMarkdown(
    {
      number: 412,
      title: 'Charged twice in March',
      ticket: 'ZD #48213',
      doc: d,
    },
    {
      status: 'Needs approval',
      person: (id) => names[id],
      playbook: 'Duplicate charge after webhook retry',
    },
  );

test('Markdown keeps the panel headings, numbers and header fields', () => {
  assert.equal(
    md(doc()),
    `# Case #412 · Charged twice in March

- **Status:** Needs approval
- **Owner:** Jimmy (support)
- **Contributors:** Sam (developer)
- **Customer:** Brightway Studio · \`cus_Nf7a\` (Confirmed)
- **Ticket:** \`ZD #48213\` · \`Linear ENG-311\`
- **Playbook:** Duplicate charge after webhook retry (suggested)
- **Updated:** 9:41 · AI for Jimmy

## 1. Summary

Charged twice on renewal.

## 2. Customer

- **Account:** Team plan

## 5. Findings

- **Confirmed:** Two invoices — Stripe in_1 _(Jimmy)_

## 8. Next step

Approve the refund.

## Similar cases

- #287 · Retry duplicate — Refunded _(Marco)_
`,
  );
});

test('empty sections are left out of the Markdown', () => {
  const out = md(doc());
  assert.ok(!out.includes('Open questions'));
  assert.ok(!out.includes('Resolution'));
});

test('Undo reverts an added entry and refuses when it changed since', () => {
  const entry = { id: 'f2', pill: 'Ruled out', text: 'Double click', by: 'AI' };
  const change = { section: 'findings', entryId: 'f2', after: entry };
  const edited = applyChange(doc(), change);
  assert.equal(edited.sections.findings.entries.length, 2);

  const undone = undoChange(edited, change);
  assert.ok('doc' in undone);
  assert.deepEqual(undone.doc.sections.findings, doc().sections.findings);

  const changed = applyChange(edited, {
    section: 'findings',
    entryId: 'f2',
    after: { ...entry, text: 'Edited' },
  });
  assert.deepEqual(undoChange(changed, change), {
    error: 'Changed since. Edit it instead.',
  });
});

test('Undo of a section-level edit hides a section that was empty', () => {
  const change = { section: 'resolution', after: { text: 'Refunded' } };
  const edited = applyChange(doc(), change);
  assert.ok(edited.sections.resolution);
  const undone = undoChange(edited, change);
  assert.equal(undone.doc.sections.resolution, undefined);
});
