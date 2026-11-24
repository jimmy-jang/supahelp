import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SyncService } from '../../../src/main/features/sync/service.ts';
import { projectDocuments } from '../../../src/main/features/sync/projection.ts';

test('case projections read the encrypted queue once and preserve pending membership', (t) => {
  const lease = { workspaceId: 'team', accountId: 'owner' };
  const docs = Array.from({ length: 40 }, (_, i) => ({
    id: `case-${i}`,
    kind: 'case',
    generation: 2,
    version: 1,
    record: { id: `case-${i}`, title: `Case ${i}`, entries: [] },
  }));
  const queue = [
    { documentId: 'case-3', type: 'title', title: 'Queued rename' },
  ];
  let reads = 0;
  const service = new SyncService({ directory: 'unused', changed() {} });
  t.mock.method(service, 'guard', () => lease);
  service.store = {
    list(prefix) {
      if (prefix === 'q/') {
        reads++;
        return structuredClone(queue);
      }
      return structuredClone(docs);
    },
  };
  const cases = service.cases();
  assert.equal(reads, 1);
  assert.equal(cases.length, 40);
  assert.equal(cases[3].title, 'Queued rename');
  assert.equal(cases[3].syncState, 'Waiting to sync');
  assert.equal(cases[4].syncState, 'Synced');
  assert.equal(cases[3].securityGeneration, 2);
  assert.equal(docs[3].record.title, 'Case 3');
});

test('optimistic projections apply creation and deletion in queue order', () => {
  const lease = { workspaceId: 'team', accountId: 'owner' };
  const queue = [
    { documentId: 'new', type: 'create-case', title: 'New case' },
    {
      documentId: 'new',
      type: 'entry',
      entryId: 'entry',
      base: 0,
      value: { section: 'summary', kind: 'text', text: 'Queued text' },
    },
  ];
  const at = () => '2026-11-18T00:00:00.000Z';
  const [created] = projectDocuments([], queue, lease, at);
  assert.equal(created.record.ownerId, 'owner');
  assert.equal(created.record.entries[0].version, 1);
  assert.equal(created.record.entries[0].text, 'Queued text');
  assert.deepEqual(
    projectDocuments(
      [],
      [...queue, { documentId: 'new', type: 'delete' }],
      lease,
      at,
    ),
    [],
  );
});

test('team edits while another entry is queued: stable projection, per-entry conflicts', async () => {
  const { SyncService } =
    await import('../../../src/main/features/sync/service.ts');
  const { TeamDocuments } =
    await import('../../../src/main/features/sync/documents.ts');
  // Reads of an unchanged queue must compare equal (no read-time timestamps).
  const sync = Object.create(SyncService.prototype);
  sync.queuedAt = new Map();
  const queue = [
    { id: 'q1', documentId: 'c', type: 'create-case', title: 'Case' },
    {
      id: 'q2',
      documentId: 'c',
      type: 'entry',
      entryId: 'e1',
      base: 0,
      value: { section: 'summary', kind: 'text', text: 'First' },
    },
  ];
  sync.guard = () => ({ workspaceId: 'w', accountId: 'a' });
  sync.store = {
    list: (prefix) => (prefix === 'q/' ? structuredClone(queue) : []),
  };
  const first = JSON.stringify(sync.cases());
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(JSON.stringify(sync.cases()), first);
  // A second entry queued during masking must not fail the edit.
  sync.queue = (type, documentId, fields) => {
    const op = { ...fields, id: `q${queue.length + 1}`, type, documentId };
    queue.push(op);
    return op;
  };
  const cases = {
    assertContext() {},
    mask: async (fields) => {
      sync.queue('entry', 'c', {
        entryId: 'parallel',
        base: 0,
        value: { section: 'findings', kind: 'item', text: 'Parallel' },
      });
      return fields;
    },
  };
  const docs = new TeamDocuments(sync, cases);
  const op = { signal: new AbortController().signal, context: {} };
  await docs.edit(
    'c',
    undefined,
    { section: 'findings', kind: 'item', text: 'Second', pill: 'Guess' },
    op,
  );
  assert.deepEqual(
    sync.cases()[0].entries.map((e) => e.text),
    ['First', 'Parallel', 'Second'],
  );
});
