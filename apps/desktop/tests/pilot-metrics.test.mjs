import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { CaseStore } from '../src/main/features/cases/store.ts';
import { CaseService } from '../src/main/features/cases/service.ts';
import { PlaybookService } from '../src/main/features/playbooks/service.ts';
import { ResolveService } from '../src/main/features/cases/resolve.ts';
import { caseEnvironment, caseOperation } from './support/case-environment.mjs';

const keys = [
  'cases_created',
  'cases_attached_to_later_chat',
  'cases_confirmed_resolved',
  'cases_currently_resolved',
  'playbooks_created_from_resolutions',
  'playbooks_updated_from_resolutions',
  'case_ai_changes',
  'case_ai_changes_undone',
  'case_ai_changes_observed_24h',
  'case_ai_changes_observed_24h_undone_within_24h',
];
async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), 'pilot-counts-'));
  const file = join(dir, 'cases.db'),
    state = caseEnvironment();
  let store, cases, books, resolve, metrics;
  let now = Date.parse('2026-11-10T12:00:00.000Z');
  const open = async () => {
    store = new CaseStore(file);
    cases = new CaseService(store, () => {}, state.environment);
    await cases.prepare(caseOperation());
    books = new PlaybookService(cases, cases.store.books, () => {});
    resolve = new ResolveService(cases, books, () => false);
    const { PilotMetrics } =
      await import('../src/main/features/pilot-metrics/service.ts');
    metrics = new PilotMetrics(cases, () => now);
  };
  await open();
  t.after(async () => {
    cases.close();
    await rm(dir, { recursive: true, force: true });
  });
  return {
    state,
    file,
    op: () => caseOperation(state.environment.context()),
    get store() {
      return store;
    },
    get cases() {
      return cases;
    },
    get books() {
      return books;
    },
    get resolve() {
      return resolve;
    },
    get metrics() {
      return metrics;
    },
    restart: async () => {
      cases.close();
      await open();
    },
    now: (value) => {
      now = value;
    },
    create: (id) =>
      cases.create(
        { id, title: 'Synthetic case', messages: [] },
        caseOperation(state.environment.context()),
      ),
    sql: (run) => {
      const db = new DatabaseSync(file);
      try {
        return run(db);
      } finally {
        db.close();
      }
    },
  };
}

test('human corrections and their Undo do not change the approved AI counts', async (t) => {
  const s = await setup(t);
  s.metrics.start(s.op());
  const id = await s.create('human-case');
  const change = await s.cases.edit(
    id,
    undefined,
    { section: 'summary', kind: 'text', text: 'Human summary' },
    { ...s.op(), humanEditRequestId: randomUUID() },
  );
  s.cases.undo(id, change.changeId, s.op());
  const report = s.metrics.finish(s.op());
  assert.equal(report.counts.case_ai_changes, 0);
  assert.equal(report.counts.case_ai_changes_undone, 0);
  assert.deepEqual(Object.keys(report.counts).sort(), [...keys].sort());
});

test('pilot opt-in excludes legacy records and survives restart; finish/reset never mutate source records', async (t) => {
  const s = await setup(t),
    old = await s.create('old');
  const before = s.store.rows();
  assert.equal(s.metrics.get(s.op()).state, 'off');
  s.metrics.start(s.op());
  s.metrics.start(s.op());
  assert.deepEqual(s.store.rows(), before);
  s.store.linkChat(old, 'old-later', new Date().toISOString());
  const id = await s.create('new');
  s.store.linkChat(id, 'later', new Date().toISOString());
  s.store.linkChat(id, 'third', new Date().toISOString());
  await s.restart();
  assert.equal(s.metrics.get(s.op()).counts.cases_created, 1);
  assert.equal(s.metrics.get(s.op()).counts.cases_attached_to_later_chat, 1);
  const source = s.store.rows(),
    finished = s.metrics.finish(s.op());
  assert.deepEqual(s.metrics.finish(s.op()), finished);
  assert.deepEqual(s.store.rows(), source);
  const report = s.metrics.report(s.op());
  assert.deepEqual(Object.keys(report).sort(), [
    'counts',
    'definitionVersion',
    'formatVersion',
  ]);
  assert.deepEqual(Object.keys(report.counts).sort(), keys.sort());
  await s.create('after-finish');
  await s.restart();
  assert.deepEqual(s.metrics.report(s.op()), report);
  assert.throws(() => s.metrics.start(s.op()), /pilot-finished/);
  s.metrics.delete(s.op());
  s.metrics.delete(s.op());
  assert.equal(s.metrics.get(s.op()).state, 'off');
  assert.throws(() => s.metrics.report(s.op()), /pilot-not-finished/);
  s.metrics.start(s.op());
  assert.equal(s.metrics.get(s.op()).counts.cases_created, 0);
});

test('only changed publications from confirmed cohort resolutions count, atomically and once', async (t) => {
  const s = await setup(t);
  s.metrics.start(s.op());
  const id = await s.create('case');
  const r = await s.resolve.save(id, 'resolution', 'Fixed', undefined, s.op());
  assert.equal(s.metrics.get(s.op()).counts.cases_confirmed_resolved, 0);
  s.resolve.confirm(r.id, r.version, s.op());
  s.resolve.confirm(r.id, r.version, s.op());
  const content = { title: 'Synthetic', markdown: 'Safe' };
  const draft = await s.books.save(undefined, 0, content, s.op(), id);
  const pub = s.books.publish(draft.id, draft.version, s.op());
  assert.throws(
    () => s.books.publish(draft.id, draft.version, s.op()),
    /case-changed/,
  );
  let next = await s.books.save(pub.id, pub.version, content, s.op(), id);
  let latest = s.books.publish(next.id, next.version, s.op());
  next = await s.books.save(
    latest.id,
    latest.version,
    { markdown: 'Safe', title: 'Synthetic' },
    s.op(),
    id,
  );
  latest = s.books.publish(next.id, next.version, s.op());
  assert.equal(
    s.metrics.get(s.op()).counts.playbooks_updated_from_resolutions,
    0,
    'object property order does not make identical content a real update',
  );
  next = await s.books.save(
    latest.id,
    latest.version,
    { ...content, markdown: 'Changed' },
    s.op(),
    id,
  );
  s.sql((db) =>
    db.exec(
      "CREATE TRIGGER fail_metrics BEFORE UPDATE ON pilot_metrics BEGIN SELECT RAISE(ABORT, 'count failure'); END",
    ),
  );
  assert.throws(
    () => s.books.publish(next.id, next.version, s.op()),
    /count failure/,
  );
  assert.equal(s.books.read(next.id, s.op()).version, next.version);
  s.sql((db) => db.exec('DROP TRIGGER fail_metrics'));
  s.books.publish(next.id, next.version, s.op());
  const manual = await s.books.save(undefined, 0, content, s.op());
  s.books.publish(manual.id, manual.version, s.op());
  s.resolve.reopen(id, s.op());
  const counts = s.metrics.finish(s.op()).counts;
  assert.equal(counts.cases_confirmed_resolved, 1);
  assert.equal(counts.cases_currently_resolved, 0);
  assert.equal(counts.playbooks_created_from_resolutions, 1);
  assert.equal(counts.playbooks_updated_from_resolutions, 1);
  assert.equal(counts.case_ai_changes, 0);
});

test('24h counts exclude recent edits even if undone; AI corrections stay AI and invalid clocks refuse reporting', async (t) => {
  const s = await setup(t);
  s.metrics.start(s.op());
  const id = await s.create('case');
  const changes = [];
  for (let n = 0; n < 4; n++)
    changes.push(
      await s.cases.edit(
        id,
        undefined,
        { section: 'summary', kind: 'text', text: `Change ${n}` },
        s.op(),
      ),
    );
  for (let n = 0; n < 3; n++) s.cases.undo(id, changes[n].changeId, s.op());
  const end = Date.parse('2026-11-10T12:00:00.000Z'),
    day = 86400000;
  s.sql((db) => {
    changes.forEach((c, n) => {
      const at = end - (n === 0 ? day - 1 : n === 1 ? day : day + 1);
      const undone =
        n === 3
          ? null
          : new Date(at + (n === 2 ? day + 1 : day - 1)).toISOString();
      db.prepare('UPDATE changes SET at=?, undone_at=? WHERE id=?').run(
        new Date(at).toISOString(),
        undone,
        c.changeId,
      );
    });
  });
  const counts = s.metrics.get(s.op()).counts;
  assert.equal(counts.case_ai_changes, 4);
  assert.equal(counts.case_ai_changes_undone, 3);
  assert.equal(counts.case_ai_changes_observed_24h, 3);
  assert.equal(counts.case_ai_changes_observed_24h_undone_within_24h, 1);
  for (const at of ['bad', new Date(end + 1).toISOString()]) {
    s.sql((db) =>
      db
        .prepare('UPDATE changes SET at=? WHERE id=?')
        .run(at, changes[0].changeId),
    );
    assert.throws(() => s.metrics.finish(s.op()), /pilot-clock/);
  }
});

test('v4 creation rolls back, preserves v3 data and used Playbook projection, and unknown state fails closed', async (t) => {
  const s = await setup(t);
  s.store.preparePlaybooks();
  const before = s.store.rows();
  s.sql((db) =>
    db.exec(
      'ALTER TABLE pilot_metrics RENAME TO retained_pilot_metrics; CREATE TABLE pilot_metrics (unexpected TEXT)',
    ),
  );
  assert.throws(() => s.metrics.start(s.op()));
  assert.equal(
    s.sql((db) => db.prepare('PRAGMA user_version').get().user_version),
    5,
  );
  assert.deepEqual(s.store.rows(), before);
  s.sql((db) =>
    db.exec(
      'DROP TABLE pilot_metrics; ALTER TABLE retained_pilot_metrics RENAME TO pilot_metrics',
    ),
  );
  s.metrics.start(s.op());
  assert.equal(
    s.sql((db) => db.prepare('PRAGMA user_version').get().user_version),
    5,
  );
  const id = await s.create('case'),
    p = await s.books.save(
      undefined,
      0,
      { title: 'Guide', markdown: '' },
      s.op(),
    );
  s.books.publish(p.id, p.version, s.op());
  const r = await s.resolve.save(id, 'resolve', 'Fixed', p.id, s.op());
  s.resolve.confirm(r.id, r.version, s.op());
  assert.equal(s.cases.read(id, s.op()).playbookId, p.id);
  s.sql((db) =>
    db
      .prepare('UPDATE pilot_metrics SET value=?')
      .run('{"state":"collecting","injected":"private"}'),
  );
  assert.throws(() => s.metrics.get(s.op()), /pilot-state/);
  assert.throws(() => s.metrics.start(s.op()), /pilot-state/);
  s.metrics.delete(s.op());
  assert.equal(s.metrics.get(s.op()).state, 'off');
});

test('interruption before Start or Finish commit leaves the previous schema/observation recoverable', async (t) => {
  const s = await setup(t);
  s.store.preparePlaybooks();
  const original = s.store.transaction.bind(s.store);
  s.store.transaction = (run) =>
    original(() => {
      run();
      throw Error('interrupted before commit');
    });
  assert.throws(() => s.metrics.start(s.op()), /interrupted/);
  assert.equal(
    s.sql((db) => db.prepare('PRAGMA user_version').get().user_version),
    5,
  );
  assert.equal(
    s.sql(
      (db) =>
        db
          .prepare(
            "SELECT COUNT(*) AS n FROM sqlite_master WHERE name='pilot_metrics'",
          )
          .get().n,
    ),
    1,
  );
  s.store.transaction = original;
  s.metrics.start(s.op());
  await s.create('new');
  s.store.transaction = (run) =>
    original(() => {
      run();
      throw Error('interrupted before commit');
    });
  assert.throws(() => s.metrics.finish(s.op()), /interrupted/);
  s.store.transaction = original;
  await s.restart();
  assert.equal(s.metrics.get(s.op()).state, 'collecting');
  assert.equal(s.metrics.finish(s.op()).counts.cases_created, 1);
});

test('exact 24h Undo is included and reversed clocks, extra export fields and unsupported versions are refused', async (t) => {
  const s = await setup(t);
  s.metrics.start(s.op());
  const id = await s.create('case'),
    c = await s.cases.edit(
      id,
      undefined,
      { section: 'summary', kind: 'text', text: 'Checked' },
      s.op(),
    );
  s.cases.undo(id, c.changeId, s.op());
  const end = '2026-11-10T12:00:00.000Z';
  s.sql((db) =>
    db
      .prepare('UPDATE changes SET at=?, undone_at=? WHERE id=?')
      .run('2026-11-09T12:00:00.000Z', end, c.changeId),
  );
  assert.equal(
    s.metrics.get(s.op()).counts.case_ai_changes_observed_24h_undone_within_24h,
    1,
  );
  s.sql((db) =>
    db
      .prepare('UPDATE changes SET undone_at=? WHERE id=?')
      .run('2026-11-09T11:59:59.999Z', c.changeId),
  );
  assert.throws(() => s.metrics.finish(s.op()), /pilot-clock/);
  s.sql((db) =>
    db
      .prepare('UPDATE changes SET undone_at=? WHERE id=?')
      .run(end, c.changeId),
  );
  s.metrics.finish(s.op());
  const saved = s.store.pilot();
  for (const report of [
    { ...saved.report, sourceId: 'private' },
    { ...saved.report, definitionVersion: 2 },
    {
      ...saved.report,
      counts: { ...saved.report.counts, case_ai_changes: -1 },
    },
  ]) {
    s.sql((db) =>
      db
        .prepare('UPDATE pilot_metrics SET value=?')
        .run(JSON.stringify({ ...saved, report })),
    );
    assert.throws(() => s.metrics.report(s.op()), /pilot-state/);
  }
  s.metrics.delete(s.op());
  s.cases.close();
  s.sql((db) => db.exec('PRAGMA user_version = 6'));
  assert.throws(() => new CaseStore(s.file), /newer Supahelp/);
});

test('metrics never start masking recovery or infer consent from an unreadied database', async (t) => {
  const s = await setup(t);
  s.cases.close();
  const store = new CaseStore(s.file),
    env = caseEnvironment();
  const cases = new CaseService(store, () => {}, env.environment);
  const { PilotMetrics } =
    await import('../src/main/features/pilot-metrics/service.ts');
  const metrics = new PilotMetrics(cases);
  for (const name of ['get', 'start', 'finish', 'delete', 'report'])
    assert.throws(
      () => metrics[name](caseOperation()),
      /case-masking-required/,
    );
  cases.close();
});
