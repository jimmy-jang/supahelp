import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CaseStore } from '../../../src/main/features/cases/store.ts';
import { CaseService } from '../../../src/main/features/cases/service.ts';
import { PilotMetrics } from '../../../src/main/features/pilot-metrics/service.ts';
import {
  caseEnvironment,
  caseOperation,
} from '../../support/case-environment.mjs';

test('pilot IPC rejects wrong frames, stale contexts, team access and all extra input before saving', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'pilot-ipc-')),
    env = caseEnvironment();
  const cases = new CaseService(
    new CaseStore(join(dir, 'cases.db')),
    () => {},
    env.environment,
  );
  t.after(async () => {
    cases.close();
    await rm(dir, { recursive: true, force: true });
  });
  await cases.prepare(caseOperation());
  const metrics = new PilotMetrics(cases),
    handlers = new Map();
  const frame = {},
    webContents = { mainFrame: frame, getURL: () => 'file:///app/index.html' };
  const event = { sender: webContents, senderFrame: frame };
  let saves = 0,
    entered,
    release;
  const { registerPilotMetricsIpc } =
    await import('../../../src/main/features/pilot-metrics/ipc.ts');
  registerPilotMetricsIpc(
    { handle: (k, v) => handlers.set(k, v) },
    () => ({ webContents }),
    'file:///app/index.html',
    metrics,
    async (_data, guard) => {
      saves++;
      if (entered) {
        entered();
        await new Promise((r) => (release = r));
      }
      guard();
      return true;
    },
  );
  const context = env.environment.context();
  for (const [name, handler] of handlers) {
    assert.equal(
      (await handler({ ...event, senderFrame: {} }, { context })).ok,
      false,
      name,
    );
    for (const value of [
      null,
      [],
      {},
      { context, counts: {} },
      { context, path: '/private' },
      { context, caseId: 'other' },
      { context: { ...context, generation: 99 } },
    ])
      assert.equal((await handler(event, value)).ok, false, name);
  }
  assert.equal(saves, 0);
  const call = (name) =>
    handlers.get(`pilot-metrics:${name}`)(event, {
      context: env.environment.context(),
    });
  assert.equal((await call('get')).value.state, 'off');
  assert.equal((await call('export')).ok, false);
  assert.equal((await call('start')).value.state, 'collecting');
  assert.equal((await call('finish')).value.state, 'finished');
  assert.equal((await call('export')).value, 'saved');
  assert.equal(saves, 1);
  const saving = new Promise((r) => (entered = r)),
    pendingExport = call('export');
  await saving;
  cases.cancelPending();
  release();
  assert.equal(
    (await pendingExport).ok,
    false,
    'window/document cancellation stops a pending export',
  );
  entered = undefined;
  env.switchContext({
    generation: 2,
    accountId: 'other',
    context: { kind: 'team', organizationId: 'org', workspaceId: 'ws' },
  });
  for (const name of ['get', 'start', 'finish', 'export', 'delete'])
    assert.equal((await call(name)).ok, false, name);
  assert.equal(saves, 2);
});

test('pending export cannot finalize after context changes or Delete and fresh opt-in', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'pilot-export-')),
    env = caseEnvironment();
  const cases = new CaseService(
      new CaseStore(join(dir, 'cases.db')),
      () => {},
      env.environment,
    ),
    metrics = new PilotMetrics(cases);
  t.after(async () => {
    cases.close();
    await rm(dir, { recursive: true, force: true });
  });
  await cases.prepare(caseOperation());
  const op = () => caseOperation(env.environment.context());
  metrics.start(op());
  metrics.finish(op());
  let complete, entered;
  const waiting = new Promise((r) => (entered = r));
  const pending = metrics.export(op(), async (_data, guard) => {
    entered();
    await new Promise((r) => (complete = r));
    guard();
    return true;
  });
  await waiting;
  metrics.delete(op());
  metrics.start(op());
  metrics.finish(op());
  complete();
  await assert.rejects(pending, /pilot-changed/);
  assert.equal(await metrics.export(op(), async () => false), 'cancelled');
  const stale = op();
  env.switchContext();
  await assert.rejects(
    metrics.export(stale, async () => {
      throw Error('must not save');
    }),
    /case-context/,
  );
});
