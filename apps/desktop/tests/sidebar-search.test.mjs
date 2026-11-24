import assert from 'node:assert/strict';
import { test } from 'node:test';
import { searchSidebar } from '../src/renderer/layout/searchSidebar.ts';

const source = {
  chats: Array.from({ length: 6 }, (_, i) => ({
    id: `chat${i}`,
    title: `Chat ${i}`,
  })),
  cases: [
    {
      id: 'case',
      title: 'Billing issue',
      number: 412,
      customer: 'Brightway',
      ticket: 'ZD #123',
    },
  ],
  playbooks: [
    { id: 'book', title: 'Refunds', what: 'Duplicate payment recovery' },
  ],
};

test('search includes every record, including chats beyond the recent list', () => {
  assert.equal(searchSidebar(source, '').length, 8);
  assert.equal(searchSidebar(source, 'Chat 5')[0].id, 'chat5');
});

test('search matches titles, case customers/numbers/tickets and Playbook descriptions', () => {
  for (const query of ['  BILLING ', 'brightway', '#412', 'ZD #123']) {
    assert.equal(searchSidebar(source, query)[0].kind, 'Case');
  }
  assert.equal(searchSidebar(source, 'recovery')[0].kind, 'Playbook');
  assert.equal(searchSidebar(source, 'refunds')[0].id, 'book');
  assert.deepEqual(searchSidebar(source, 'missing'), []);
  assert.deepEqual(
    searchSidebar({ chats: [], cases: [], playbooks: [] }, ''),
    [],
  );
});
