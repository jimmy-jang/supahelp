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
    keys: (prefix) => (prefix === 'd/' ? docs.map(({ id }) => `d/${id}`) : []),
    get: (key) => structuredClone(docs.find(({ id }) => key === `d/${id}`)),
    list(prefix) {
      assert.equal(prefix, 'q/');
      reads++;
      return structuredClone(queue);
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
  sync.assertContext = () => {};
  sync.store = {
    keys: () => [],
    get: () => undefined,
    list: (prefix) => (prefix === 'q/' ? structuredClone(queue) : []),
  };
  const first = JSON.stringify(sync.cases());
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(JSON.stringify(sync.cases()), first);
  // A second entry queued during masking must not fail the edit.
  sync.queue = (type, documentId, fields) => {
    const op = { ...fields, id: `q${queue.length + 1}`, type, documentId };
    queue.push(op);
    sync.store.documentsChanged(new Map([[`q/${op.id}`, op]]));
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

test('committed cache changes refresh only affected projections, and locked search closes its index', async (t) => {
  const { TeamProjection } =
    await import('../../../src/main/features/sync/projection.ts');
  const lease = { workspaceId: 'team', accountId: 'owner' };
  const record = (id, number, text) => ({
    kind: 'case',
    id,
    generation: 1,
    version: 1,
    record: {
      id,
      number,
      title: 'Invoice retry',
      status: 'done',
      ticket: 'ZD #4821',
      customer: { name: '', confirmed: false },
      updatedAt: '2026-11-25',
      entries: [{ id: 'text', section: 'summary', text }],
    },
  });
  const rows = new Map([
    ['d/a', record('a', 4821, 'Originalmarker')],
    ['d/b', record('b', 48210, 'Othermarker')],
  ]);
  const reads = [];
  const store = {
    keys: (prefix) => [...rows.keys()].filter((key) => key.startsWith(prefix)),
    get: (key) => {
      reads.push(key);
      return structuredClone(rows.get(key));
    },
    list: () => [],
  };
  const projected = new TeamProjection(store);
  t.after(() => projected.close());
  assert.equal(
    projected.searchIndex(lease).lookup('case_number', '#4821')[0].id,
    'a',
  );
  reads.length = 0;
  assert.equal(
    projected.searchIndex(lease).search('Originalmarker').cases[0].id,
    'a',
  );
  assert.deepEqual(reads, []);

  const op = {
    id: 'q',
    type: 'entry',
    documentId: 'a',
    entryId: 'text',
    value: { section: 'summary', text: 'Queuedmarker' },
    base: 1,
  };
  projected.changed(new Map([['q/q', op]]));
  assert.equal(
    projected.searchIndex(lease).search('Queuedmarker').cases[0].id,
    'a',
  );
  assert.deepEqual(
    projected.searchIndex(lease).search('Originalmarker').cases,
    [],
  );
  assert.ok(reads.every((key) => key.endsWith('/a')));
  projected.changed(new Map([['q/q', undefined]]));
  assert.equal(
    projected.searchIndex(lease).search('Originalmarker').cases[0].id,
    'a',
  );

  projected.changed(
    new Map([['q/flag', { id: 'flag', type: 'flag', documentId: 'a' }]]),
  );
  assert.deepEqual(
    projected.searchIndex(lease).lookup('case_number', '#4821'),
    [],
  );
  rows.delete('d/a');
  projected.changed(
    new Map([
      ['d/a', undefined],
      ['q/flag', undefined],
    ]),
  );
  assert.deepEqual(
    projected.searchIndex(lease).search('Originalmarker').cases,
    [],
  );

  rows.set('d/a', record('a', 4821, 'Correctedmarker'));
  projected.changed(new Map([['d/a', rows.get('d/a')]]));
  assert.equal(
    projected.searchIndex(lease).search('Correctedmarker').cases[0].id,
    'a',
  );
  const stale = projected.searchIndex(lease);
  projected.close();
  assert.throws(() => stale.search('Correctedmarker'), /closed|not open/i);
});
