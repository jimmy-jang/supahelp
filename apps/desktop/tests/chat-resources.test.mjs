import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ChatResources } from '../src/main/platform/chat-resources.ts';

test('projects persist, missing paths and arbitrary renderer paths are rejected', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'supahelp-resources-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const file = join(home, 'projects.json');
  const resources = new ChatResources(file);
  await assert.rejects(
    () => resources.validateProject(join(home, 'unconnected')),
    /invalid-project/,
  );
  const project = await resources.connect(home);
  const restored = new ChatResources(file);
  assert.ok((await restored.list()).some((item) => item.path === project.path));
  await restored.validateProject(project.path);
});

test('attachments expose metadata only and resolve only picker-issued IDs', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'supahelp-files-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const resources = new ChatResources(join(home, 'projects.json'));
  const path = join(home, 'notes.txt');
  await writeFile(path, 'customer context');
  const [file] = await resources.attach([path]);
  assert.deepEqual(Object.keys(file).sort(), ['id', 'name', 'size']);
  assert.equal(
    Buffer.from(resources.resolve([file.id])[0].data, 'base64').toString(),
    'customer context',
  );
  assert.throws(() => resources.resolve([path]), /invalid-attachment/);
  resources.consume([file.id]);
  assert.throws(() => resources.resolve([file.id]), /invalid-attachment/);
  await writeFile(path, Buffer.from([0, 1, 2]));
  await assert.rejects(
    () => resources.attach([path]),
    /unsupported-attachment/,
  );
  await writeFile(join(home, 'fake.png'), 'not an image');
  await assert.rejects(
    () => resources.attach([join(home, 'fake.png')]),
    /unsupported-attachment/,
  );
  await assert.rejects(
    () => resources.attach(Array(6).fill(path)),
    /invalid-attachment/,
  );
  await writeFile(path, Buffer.alloc(10 * 1024 * 1024 + 1));
  await assert.rejects(() => resources.attach([path]), /invalid-attachment/);
});
