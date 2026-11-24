import assert from 'node:assert/strict';
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  readdirSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { after, test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { CaseStore } from '../../../src/main/features/cases/store.ts';
import {
  CaseService,
  CHANGED_SINCE,
} from '../../../src/main/features/cases/service.ts';
import {
  caseEnvironment,
  caseOperation,
  encryption,
} from '../../support/case-environment.mjs';

const directory = mkdtempSync(join(tmpdir(), 'supahelp-case-migration-'));
after(() => rmSync(directory, { recursive: true, force: true }));
let serial = 0;
async function legacy() {
  const file = join(directory, `legacy-${serial++}.db`),
    store = new CaseStore(file);
  await store.recover(encryption, () => {});
  store.insertCase({
    id: 'case-a',
    workspaceId: 'personal',
    ownerId: 'local',
    title: 'Alex Example alex@example.test',
    ticket: 'ZD #123',
    chatId: 'chat-a',
    at: '2026-11-09T00:00:00Z',
  });
  const entry = {
    section: 'findings',
    kind: 'item',
    text: 'Alex Example at 12 Example Road',
    detail: 'Stripe in_1',
    pill: 'Confirmed',
  };
  store.writeEntry({
    caseId: 'case-a',
    entryId: 'entry-a',
    value: entry,
    position: 1,
    version: 1,
    expectedVersion: 0,
    by: 'local',
    at: '2026-11-09T00:00:01Z',
    change: { id: 'change-a' },
  });
  store.writeEntry({
    caseId: 'case-a',
    entryId: 'deleted-a',
    value: { ...entry, text: 'alex@example.test' },
    position: 2,
    version: 1,
    expectedVersion: 0,
    by: 'local',
    at: '2026-11-09T00:00:02Z',
    change: { id: 'change-b' },
  });
  store.writeEntry({
    caseId: 'case-a',
    entryId: 'deleted-a',
    position: 2,
    version: 2,
    expectedVersion: 1,
    by: 'local',
    at: '2026-11-09T00:00:03Z',
    change: { id: 'change-c', before: { ...entry, text: 'alex@example.test' } },
  });
  store.close();
  const db = new DatabaseSync(file);
  db.exec(
    'ALTER TABLE entries DROP COLUMN system_owned; ALTER TABLE changes DROP COLUMN applied_version; PRAGMA user_version = 1;',
  );
  db.close();
  return file;
}
const open = (file, state = caseEnvironment()) => ({
  ...state,
  service: new CaseService(new CaseStore(file), () => {}, state.environment),
  op: () => caseOperation(state.environment.context()),
});

test('Playbook persistence follows the active connection after a legacy database cutover', async (t) => {
  const file = await legacy();
  const a = open(file);
  t.after(() => a.service.close());
  const books = a.service.store.books;
  await a.service.prepare(a.op());
  assert.deepEqual(books.playbooks(), []);
  books.savePlaybook(
    {
      id: 'after-cutover',
      workspaceId: 'personal',
      ownerId: 'local',
      version: 1,
      updatedAt: '2026-11-16T00:00:00Z',
      draft: { title: 'Preserved connection', markdown: 'Safe text' },
    },
    0,
  );
  assert.equal(books.playbooks()[0].id, 'after-cutover');
});

test('v1 migration masks current, deleted and historical text, retaining records and local ownership', async () => {
  const file = await legacy(),
    a = open(file);
  assert.deepEqual(a.service.snapshot().cases, []);
  await a.service.prepare(a.op());
  const [c] = a.service.snapshot().cases;
  assert.equal(c.title, 'Alex Example [EMAIL]');
  assert.equal(c.id, 'case-a');
  assert.equal(c.ownerId, 'local');
  assert.deepEqual(c.chatIds, ['chat-a']);
  assert.equal(c.number, 1);
  assert.equal(c.createdAt, '2026-11-09T00:00:00Z');
  assert.equal(c.entries[0].text, 'Alex Example at 12 Example Road');
  assert.equal(c.changes.length, 3);
  assert.deepEqual(a.service.undo(c.id, 'change-a', a.op()), {
    error: CHANGED_SINCE,
  });
  a.service.close();
  const db = new DatabaseSync(file);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 2);
  assert.equal(
    db.prepare('SELECT text FROM entries WHERE id = ?').get('deleted-a').text,
    '[EMAIL]',
  );
  assert.ok(
    db.prepare('SELECT deleted_at FROM entries WHERE id = ?').get('deleted-a')
      .deleted_at,
  );
  db.close();
  for (const name of readdirSync(directory).filter((name) =>
    name.startsWith(basename(file)),
  )) {
    assert.ok(!name.includes('recovery') && !name.includes('masked-next'));
    const bytes = readFileSync(join(directory, name));
    assert.equal(bytes.includes(Buffer.from('alex@example.test')), false);
  }
});

test('unavailable OS encryption preserves the original and blocks case access', async () => {
  const file = await legacy(),
    state = caseEnvironment();
  state.environment.encryption = {
    ...encryption,
    isEncryptionAvailable: () => false,
  };
  const a = open(file, state);
  await assert.rejects(a.service.prepare(a.op()));
  assert.deepEqual(a.service.snapshot().cases, []);
  a.service.close();
  const db = new DatabaseSync(file);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 1);
  assert.equal(
    db.prepare('SELECT title FROM cases').get().title,
    'Alex Example alex@example.test',
  );
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM changes').get().n, 3);
  db.close();
});

test('unknown historical metadata blocks migration without silently storing unchecked text', async () => {
  const file = await legacy(),
    db = new DatabaseSync(file);
  const original = JSON.parse(
    db.prepare('SELECT after FROM changes WHERE id = ?').get('change-a').after,
  );
  db.prepare('UPDATE changes SET after = ? WHERE id = ?').run(
    JSON.stringify({ ...original, privateNote: 'Alex Example' }),
    'change-a',
  );
  db.close();
  const a = open(file);
  await assert.rejects(a.service.prepare(a.op()), /case-recovery/);
  assert.deepEqual(a.service.snapshot().cases, []);
  a.service.close();
  const retained = new DatabaseSync(file);
  assert.equal(retained.prepare('PRAGMA user_version').get().user_version, 1);
  assert.match(
    retained.prepare('SELECT after FROM changes WHERE id = ?').get('change-a')
      .after,
    /privateNote/,
  );
  retained.close();
});

test('interruption before cutover retains an encrypted recovery snapshot and resumes without record loss', async () => {
  const file = await legacy(),
    a = open(file),
    controller = new AbortController();
  const op = {
    ...a.op(),
    signal: controller.signal,
    guard: () => {
      if (existsSync(`${file}.recovery.enc`)) controller.abort();
    },
  };
  await assert.rejects(a.service.prepare(op));
  assert.ok(existsSync(`${file}.recovery.enc`));
  assert.equal(
    readFileSync(`${file}.recovery.enc`).includes(Buffer.from('Alex Example')),
    false,
  );
  assert.deepEqual(a.service.snapshot().cases, []);
  a.service.close();
  const b = open(file);
  await b.service.prepare(b.op());
  assert.equal(b.service.snapshot().cases.length, 1);
  assert.equal(b.service.snapshot().cases[0].changes.length, 3);
  assert.equal(existsSync(`${file}.recovery.enc`), false);
  b.service.close();
});

test('interruption after cutover verifies the masked replacement on restart without repeating inference', async () => {
  const file = await legacy(),
    a = open(file),
    controller = new AbortController();
  const op = {
    ...a.op(),
    signal: controller.signal,
    guard: () => {
      if (
        existsSync(`${file}.recovery.enc`) &&
        readFileSync(file).readUInt32BE(60) === 2
      )
        controller.abort();
    },
  };
  await assert.rejects(a.service.prepare(op));
  assert.ok(existsSync(`${file}.recovery.enc`));
  assert.deepEqual(a.service.snapshot().cases, []);
  a.service.close();
  const b = open(file);
  await b.service.prepare(b.op());
  assert.equal(b.service.snapshot().cases[0].title, 'Alex Example [EMAIL]');
  assert.equal(existsSync(`${file}.recovery.enc`), false);
  b.service.store.setResolved('case-a', true, '2026-11-25');
  const index = b.service.store.searchIndex();
  assert.equal(index.search('Example Road').cases[0].id, 'case-a');
  assert.deepEqual(index.search('test').cases, []);
  assert.equal(b.prompts.length, 0);
  b.service.close();
});
