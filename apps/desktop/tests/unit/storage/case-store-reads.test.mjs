import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync, StatementSync } from 'node:sqlite';
import { CaseStore } from '../../../src/main/features/cases/store.ts';

test('case graph reads use bounded queries and preserve empty cases, entries and history', (t) => {
  const store = new CaseStore(':memory:');
  t.after(() => store.close());
  store.ready = true;
  store.preparePlaybooks();
  for (let i = 0; i < 40; i++) {
    store.insertCase({
      id: `case-${i}`,
      workspaceId: 'personal',
      ownerId: 'local',
      title: `Case ${i}`,
      ticket: '',
      chatId: `chat-${i}`,
      at: String(i).padStart(3, '0'),
    });
    if (i > 0)
      store.writeEntry({
        caseId: `case-${i}`,
        entryId: `entry-${i}`,
        value: { section: 'summary', kind: 'text', text: `Text ${i}` },
        position: 0,
        version: 1,
        expectedVersion: 0,
        by: 'local',
        at: '100',
        change: { id: `change-${i}` },
      });
  }
  store.removeCase('case-20', '999');
  const expected = store.cases();
  const all = StatementSync.prototype.all;
  const scanned = [];
  t.mock.method(StatementSync.prototype, 'all', function (...args) {
    const rows = all.apply(this, args);
    scanned.push(...rows);
    return rows;
  });
  const prepare = DatabaseSync.prototype.prepare;
  let queries = 0;
  t.mock.method(DatabaseSync.prototype, 'prepare', function (...args) {
    queries++;
    return prepare.apply(this, args);
  });
  const records = store.cases();
  assert.deepEqual(records, expected);
  assert.equal(records.length, 39);
  assert.deepEqual(records.at(-1).entries, []);
  assert.equal(
    records.find((r) => r.id === 'case-39').entries[0].text,
    'Text 39',
  );
  assert.equal(
    records.find((r) => r.id === 'case-39').changes[0].id,
    'change-39',
  );
  assert.ok(queries <= 5, `${queries} queries for 40 cases`);
  assert.ok(!scanned.some((row) => row.case_id === 'case-20'));
});
