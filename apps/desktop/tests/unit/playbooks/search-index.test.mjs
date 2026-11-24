import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { SearchIndex } from '../../../src/main/features/playbooks/search-index.ts';

function fixture(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  return new SearchIndex(db);
}
const doc = (id, title, body, extra = {}) => ({
  kind: 'case',
  id,
  title,
  body,
  description: '',
  searchable: true,
  updatedAt: '2026-11-25',
  ...extra,
});

test('FTS5 ranks descriptions and titles, with independent limits and rare body excerpts', (t) => {
  const index = fixture(t);
  for (let n = 0; n < 9; n++)
    index.upsert(doc(`common-${n}`, 'Reference', 'Invoice retry'));
  index.upsert(doc('invoice', 'Invoice retry', 'Typical instructions'));
  index.upsert(
    doc('description', 'Reference', 'Typical instructions', {
      description: 'Invoice retry',
    }),
  );
  index.upsert(
    doc(
      'code',
      'Échec',
      `Invoice retry\n${'context '.repeat(50)}HTTP ４０９ QZX`,
    ),
  );
  index.upsert(
    doc('book', 'Invoice retry', 'Instructions', { kind: 'playbook' }),
  );
  assert.equal(index.search('Invoice retry').cases.length, 5);
  assert.deepEqual(
    index
      .search('Invoice retry')
      .cases.slice(0, 2)
      .map(({ id }) => id),
    ['invoice', 'description'],
  );
  assert.equal(index.search('Invoice retry').playbooks[0].id, 'book');
  const result = index.search('retry HTTP 409').cases[0];
  assert.equal(result.id, 'code');
  assert.match(result.excerpt, /HTTP ４０９/);
  assert.ok(result.excerpt.length <= 240);
  assert.equal(index.search('"ÉCHEC" OR (409*)').cases[0].id, 'code');
  assert.deepEqual(index.search('the and how (?)'), {
    cases: [],
    playbooks: [],
  });
  assert.ok(index.search('409', { excludeCaseId: 'code' }).cases.length === 0);
});

test('exact references use separate identities and include open cases and published title duplicates', (t) => {
  const index = fixture(t);
  index.upsert(
    doc('case', 'Example', 'Private open text', {
      number: 4821,
      ticket: 'ZD #48210',
      searchable: false,
    }),
  );
  index.upsert(
    doc('next', 'Longer number', '', {
      number: 48210,
      ticket: 'https://acme.zendesk.com/agent/tickets/4821',
    }),
  );
  index.upsert(
    doc('duplicate', 'Same ticket', '', {
      number: 8,
      ticket: 'Zendesk ticket #4821',
    }),
  );
  index.upsert(
    doc('linear', 'Another provider', '', {
      issue: 'https://linear.app/acme/issue/ENG-4821',
    }),
  );
  index.upsert(
    doc('one', 'Invoice Retry', '', {
      kind: 'playbook',
      draftTitle: 'Renamed draft',
    }),
  );
  index.upsert(doc('two', 'invoice retry', '', { kind: 'playbook' }));
  index.upsert(doc('three', 'Invoice Retry Guide', '', { kind: 'playbook' }));
  assert.deepEqual(
    index.lookup('case_number', '#4821').map(({ id }) => id),
    ['case'],
  );
  assert.deepEqual(
    index.lookup('ticket_reference', 'Zendesk ticket 4821').map(({ id }) => id),
    ['duplicate', 'next'],
  );
  assert.deepEqual(
    index.lookup('ticket_reference', 'Linear ENG-4821').map(({ id }) => id),
    ['linear'],
  );
  assert.deepEqual(index.lookup('ticket_reference', '4821'), []);
  assert.deepEqual(
    index
      .lookup('playbook_title', ' Ｉｎｖｏｉｃｅ Retry ')
      .map(({ id }) => id),
    ['one', 'two'],
  );
  assert.deepEqual(index.lookup('playbook_title', 'Renamed draft'), []);
  assert.deepEqual(index.lookup('playbook_title', 'Invoice'), []);
  assert.deepEqual(index.search('private'), { cases: [], playbooks: [] });
  index.remove('playbook', 'one');
  assert.deepEqual(
    index.lookup('playbook_title', 'Invoice Retry').map(({ id }) => id),
    ['two'],
  );
});

test('runtime without FTS5 retains eligible keyword matches and exact references', (t) => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const exec = db.exec.bind(db);
  t.mock.method(db, 'exec', (sql) => {
    if (sql.includes('USING fts5(')) throw Error('no such module: fts5');
    return exec(sql);
  });
  const index = new SearchIndex(db);
  assert.equal(index.fts, false);
  index.upsert(
    doc('open', 'Invoice retry', 'Private draft', {
      number: 4821,
      searchable: false,
    }),
  );
  index.upsert(doc('resolved', 'Invoice retry', 'HTTP 409', { number: 48210 }));
  assert.deepEqual(
    index.lookup('case_number', '#4821').map(({ id }) => id),
    ['open'],
  );
  assert.deepEqual(
    index.search('retry').cases.map(({ id }) => id),
    ['resolved'],
  );
  index.remove('case', 'resolved');
  assert.deepEqual(index.search('retry').cases, []);
});
