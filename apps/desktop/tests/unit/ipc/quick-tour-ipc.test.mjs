import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { registerQuickTourIpc } from '../../../src/main/features/tour/ipc.ts';

test('quick tour state is private to the app window and survives reads', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'quick-tour-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'nested', 'quick-tour.json');
  const handlers = new Map();
  const frame = {};
  const location = 'file:///app/index.html';
  const webContents = { mainFrame: frame, getURL: () => location };
  registerQuickTourIpc(
    { handle: (name, run) => handlers.set(name, run) },
    () => ({ webContents }),
    location,
    file,
  );
  const trusted = { sender: webContents, senderFrame: frame };
  const get = handlers.get('quick-tour:get');
  const complete = handlers.get('quick-tour:complete');

  assert.deepEqual(await get(trusted), { ok: true, value: { seen: false } });
  assert.equal(
    (await complete({ sender: webContents, senderFrame: {} })).ok,
    false,
  );
  assert.equal((await complete(trusted, { seen: false })).ok, false);
  assert.deepEqual(await get(trusted), { ok: true, value: { seen: false } });

  assert.deepEqual(await complete(trusted), {
    ok: true,
    value: { seen: true },
  });
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { seen: true });
  assert.deepEqual(await get(trusted), { ok: true, value: { seen: true } });

  await writeFile(file, 'not json');
  assert.deepEqual(await get(trusted), { ok: true, value: { seen: false } });
});
