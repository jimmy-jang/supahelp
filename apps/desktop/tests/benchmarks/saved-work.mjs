// Run each workspace and size in a fresh Node 24 process to compare peak RSS.
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setImmediate } from 'node:timers/promises';
import { CaseStore } from '../../src/main/features/cases/store.ts';
import { rankDocuments } from '../../src/main/features/playbooks/search.ts';
import {
  caseSearchDocument,
  normalizeLookup,
  playbookSearchDocument,
} from '../../src/main/features/playbooks/search-index.ts';
import { TeamProjection } from '../../src/main/features/sync/projection.ts';
import { TeamStore } from '../../src/main/platform/team-store.ts';
import { encryption } from '../support/case-environment.mjs';

const [scope = 'personal', size = 10000] = process.argv.slice(2);
const n = Number(size);
assert.ok(['personal', 'team'].includes(scope) && n >= 100);
const directory = await mkdtemp(join(tmpdir(), 'saved-work-bench-'));
const file = join(directory, 'cases.db');
const at = '2026-11-25T00:00:00.000Z';
const lease = { accountId: 'benchmark', workspaceId: 'benchmark-team' };
const workspaceId = scope === 'personal' ? 'personal' : lease.workspaceId;
const ownerId = scope === 'personal' ? 'local' : lease.accountId;
const documents = [];
const baseline = { case: [], playbook: [] };
const exact = [
  ['case_number', '#4821', 'open'],
  ['case_number', '#482', undefined],
  ['case_number', '#48210', 'next'],
  ['ticket_reference', 'Zendesk ticket 4821', 'related-case'],
  ['ticket_reference', 'Linear ENG-4821', 'linear'],
  ['ticket_reference', 'Zendesk ticket 482', undefined],
  ['playbook_title', 'Invoice Retry', 'invoice-book'],
  ['playbook_title', 'Invoice Ret', undefined],
  ['playbook_title', 'Draft SSH Rotation', undefined],
];
const related = [
  ['case', 'HTTP 409 after invoice retry', 'related-case'],
  ['case', 'NKW-8021', 'rare'],
  ['case', 'SAML ACS', 'saml'],
  ['case', 'people cannot log in', 'saml'],
  ['case', 'invoice charged twice', 'related-case'],
  ['case', 'database request timeout', 'timeout'],
  ['playbook', 'rotate SSH keys', 'ssh'],
  ['playbook', 'invoice from card duplicate charge', 'invoice-book'],
  ['playbook', 'reset access token', 'token'],
  ['playbook', 'rollback after ENOENT', 'rollback'],
  ['playbook', 'renew TLS certificate', 'tls'],
  ['case', 'duplicate rows merging accounts', 'merge'],
];
const caseDoc = (
  id,
  number,
  title,
  text,
  { status = 'done', ticket = '', issue } = {},
) => ({
  id,
  number,
  title,
  status,
  ticket,
  issue,
  createdAt: at,
  updatedAt: at,
  workspaceId,
  ownerId,
  customer: { name: '', confirmed: false },
  changes: [],
  chatIds: [],
  entries: text
    ? [
        {
          id: `entry-${id}`,
          section: 'summary',
          kind: 'text',
          authorId: ownerId,
          position: 0,
          updatedAt: at,
          version: 1,
          text,
        },
      ]
    : [],
});
const book = (id, title, text, draftTitle) => ({
  id,
  version: 1,
  workspaceId,
  ownerId,
  updatedAt: at,
  publishedAt: at,
  published: { title, markdown: text },
  ...(draftTitle && {
    draft: { title: draftTitle, markdown: 'Unpublished secret' },
  }),
});
for (const record of [
  caseDoc('open', 4821, 'Open investigation', '', { status: 'inv' }),
  caseDoc('next', 48210, 'Another case', 'A different invoice.', {
    ticket: 'ZD #48210',
  }),
  caseDoc(
    'related-case',
    4,
    'Duplicate invoice retry',
    'A stale idempotency key returned HTTP 409. The invoice was charged twice.',
    { ticket: 'ZD #4821' },
  ),
  caseDoc(
    'linear',
    6,
    'Linear issue follow-up',
    'Issue fixed in a later release.',
    { issue: 'Linear ENG-4821' },
  ),
  caseDoc(
    'rare',
    9,
    'Storage checks',
    `${'Storage continued reporting healthy status. '.repeat(12)}The engine returned NKW-8021.`,
  ),
  caseDoc(
    'saml',
    10,
    'SSO for enterprise users',
    'The SAML ACS URL differed from the service provider metadata.',
  ),
  caseDoc(
    'timeout',
    11,
    'Database request timeout',
    'Increase the pool idle timeout after monitoring.',
  ),
  caseDoc(
    'merge',
    12,
    'Duplicate rows merging accounts',
    'Backfill the canonical account ID and remove duplicate rows.',
  ),
])
  documents.push(['case', record]);
for (const record of [
  book(
    'invoice-book',
    'Invoice Retry',
    'Prevent a duplicate charge retrying a card invoice.',
  ),
  book(
    'ssh',
    'Rotate SSH keys',
    'Generate a replacement key and confirm old access is removed.',
    'Draft SSH Rotation',
  ),
  book(
    'token',
    'Reset access token',
    'Issue a scoped token with an expiry suitable for testing.',
  ),
  book(
    'rollback',
    'Rollback procedure',
    'Use the original release if a build fails. For file ENOENT, check the artifact path.',
  ),
  book(
    'tls',
    'Renew TLS certificate',
    'Verify the current chain then rotate the certificate.',
  ),
])
  documents.push(['playbook', record]);
const subjects = [
  'invoice retry',
  'login recovery',
  'sync warning',
  'database latency',
  'refund review',
  'saved view',
  'import failure',
  'timeout alert',
  'merge accounts',
];
for (let i = documents.length; i < n; i++) {
  const topic = subjects[i % subjects.length];
  const body =
    `The ${topic} was reviewed with the support team. Reference record ${i}.\n` +
    'Confirm the recorded finding, then check the service status and recent changes. '.repeat(
      12,
    );
  if (i % 5 === 0)
    documents.push([
      'playbook',
      book(`book-${i}`, `Troubleshoot ${topic}`, body),
    ]);
  else
    documents.push([
      'case',
      caseDoc(`case-${i}`, 100000 + i, `Investigate ${topic}`, body, {
        status: i % 7 === 0 ? 'inv' : 'done',
      }),
    ]);
}
for (const [kind, record] of documents) {
  const doc =
    kind === 'case'
      ? caseSearchDocument(record)
      : playbookSearchDocument(record);
  if (doc.searchable)
    baseline[kind].push({
      id: doc.id,
      title: doc.number ? `#${doc.number} · ${doc.title}` : doc.title,
      updatedAt: doc.updatedAt,
      excerpt: doc.body,
    });
}

let store, projection, db, index;
try {
  if (scope === 'personal') {
    store = new CaseStore(file);
    store.ready = true;
    store.preparePlaybooks();
    db = new DatabaseSync(file);
    const addCase = db.prepare(
      `INSERT INTO cases(id,workspace_id,number,title,status,owner_id,ticket,issue,customer_name,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
    );
    const addEntry = db.prepare(
      `INSERT INTO entries(id,case_id,section,kind,text,position,version,author_id,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`,
    );
    const addBook = db.prepare('INSERT INTO playbooks VALUES(?,?,?)');
    db.exec('BEGIN');
    for (const [kind, record] of documents) {
      if (kind === 'playbook') {
        addBook.run(record.id, 1, JSON.stringify(record));
        continue;
      }
      addCase.run(
        record.id,
        workspaceId,
        record.number,
        record.title,
        record.status,
        ownerId,
        record.ticket,
        record.issue ?? null,
        '',
        at,
        at,
      );
      for (const e of record.entries)
        addEntry.run(
          e.id,
          record.id,
          e.section,
          e.kind,
          e.text,
          e.position,
          e.version,
          e.authorId,
          e.updatedAt,
        );
    }
    db.exec('COMMIT; PRAGMA wal_checkpoint(TRUNCATE)');
  } else {
    store = await TeamStore.open(directory, 'team-fixture', encryption);
    store.transaction(() => {
      for (const [kind, record] of documents)
        store.put(`d/${record.id}`, {
          id: record.id,
          kind,
          record,
          generation: 1,
          version: 1,
        });
    });
  }
  globalThis.gc?.();
  const beforeBytes = scope === 'personal' ? (await stat(file)).size : 0;
  const beforeRSS = process.memoryUsage.rss();
  const start = performance.now();
  let maxSliceMs = 0,
    previous = start;
  if (scope === 'team') projection = new TeamProjection(store);
  for (;;) {
    try {
      index =
        scope === 'personal'
          ? store.searchIndex()
          : projection.searchIndex(lease);
      break;
    } catch (error) {
      if (error.message !== 'search-preparing') throw error;
    }
    await setImmediate();
    const now = performance.now();
    maxSliceMs = Math.max(maxSliceMs, now - previous);
    previous = now;
  }
  const coldMs = performance.now() - start;
  const buildRSS = process.memoryUsage.rss() - beforeRSS;
  assert.equal(index.fts, true);
  let sizeBytes;
  if (db) {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    sizeBytes = (await stat(file)).size - beforeBytes;
  } else {
    // In-memory database, page size × page count, including its metadata and FTS tables.
    sizeBytes =
      projection.searchDb.prepare('PRAGMA page_count').get().page_count *
      projection.searchDb.prepare('PRAGMA page_size').get().page_size;
  }

  const find = (kind, query) => {
    if (kind === 'case_number' && scope === 'personal')
      return store.caseReference(Number(query.slice(1)))?.id;
    return index.lookup(kind, query)[0]?.id;
  };
  const oldExact = (kind, query) => {
    if (kind === 'case_number')
      return rankDocuments(query, baseline.case)[0]?.id;
    if (kind === 'ticket_reference') {
      const word = query.split(' ').at(-1).toLowerCase();
      return documents.find(
        ([kind, d]) =>
          kind === 'case' &&
          (d.ticket || d.issue) &&
          [d.title, d.ticket, d.issue].some((s) =>
            s?.toLowerCase().includes(word),
          ),
      )?.[1].id;
    }
    return documents.find(
      ([kind, d]) =>
        kind === 'playbook' &&
        [d.draft?.title, d.published?.title].some(
          (s) => s && normalizeLookup(s).includes(normalizeLookup(query)),
        ),
    )?.[1].id;
  };
  const exactResults = exact.map(([kind, query, expected]) => ({
    query,
    baseline: oldExact(kind, query) === expected,
    indexed: find(kind, query) === expected,
  }));
  const oldRelated = (query) => ({
    cases: rankDocuments(query, baseline.case),
    playbooks: rankDocuments(query, baseline.playbook),
  });
  const relevance = related.map(([kind, query, expected]) => ({
    query,
    baseline: oldRelated(query)[`${kind}s`].some((d) => d.id === expected),
    indexed: index.search(query)[`${kind}s`].some((d) => d.id === expected),
  }));
  assert.ok(exactResults.every(({ indexed }) => indexed));
  assert.ok(
    relevance.every(({ baseline, indexed }) => !baseline || indexed),
    JSON.stringify(relevance),
  );
  const measure = (fn, iterations) => {
    for (let i = 0; i < 3; i++) fn(i);
    const ms = Array.from({ length: iterations }, (_, i) => {
      const start = performance.now();
      fn(i);
      return performance.now() - start;
    }).sort((a, b) => a - b);
    return +ms[Math.ceil(ms.length * 0.95) - 1].toFixed(2);
  };
  const latency = {};
  for (const [label, queries] of [
    ['broad', ['invoice retry', 'database timeout', 'merge accounts']],
    ['specific', ['NKW-8021', 'SAML ACS', 'ENOENT']],
  ]) {
    const query = (i) => queries[i % queries.length];
    latency[label] = {
      baseline: measure((i) => oldRelated(query(i)), n === 50000 ? 9 : 21),
      indexed: measure((i) => index.search(query(i)), 75),
    };
  }
  latency.exact = {
    baseline: measure((i) => oldExact(...exact[i % exact.length]), 30),
    indexed: measure((i) => find(...exact[i % exact.length]), 100),
  };
  console.log(
    JSON.stringify({
      scope,
      documents: n,
      coldMs: Math.round(coldMs),
      maxSliceMs: +maxSliceMs.toFixed(1),
      buildRSSMiB: +(buildRSS / 1024 ** 2).toFixed(2),
      derivedMiB: +(sizeBytes / 1024 ** 2).toFixed(2),
      warmP95Ms: latency,
      exact: exactResults,
      related: relevance,
    }),
  );
} finally {
  projection?.close();
  db?.close();
  store?.close();
  await rm(directory, { recursive: true, force: true });
}
