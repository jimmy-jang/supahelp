import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PlaybookScreenshots } from '../src/main/platform/playbook-screenshots.ts';

test('screenshots stage in memory and persist only on confirmation', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'playbook-images-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const pixels = Buffer.alloc(16, 255);
  const codec = {
    decode: () => ({ width: 2, height: 2, pixels: Buffer.from(pixels) }),
    encode: (image) => Buffer.from(image.pixels),
  };
  const shots = new PlaybookScreenshots(dir, codec);
  await shots.prepare();
  const png = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
  png.writeUInt32BE(2, 16);
  png.writeUInt32BE(2, 20);
  const preview = shots.stage('book', png);
  assert.deepEqual(await readdir(dir), []);
  assert.equal(shots.allowed('book', preview.id), false);
  await shots.confirm('book', preview.id, () => {});
  assert.equal(shots.allowed('book', preview.id), true);
  assert.equal((await readdir(dir)).length, 1);
  assert.throws(
    () => shots.stage('book', Buffer.from('bad')),
    /invalid-screenshot/,
  );
  assert.throws(() => shots.preview('other', preview.id));
  const staged = shots.stage('book', png);
  shots.discard('book', staged.id);
  assert.throws(() => shots.preview('book', staged.id), /invalid-screenshot/);
  const other = shots.stage('other', png);
  await shots.confirm('other', other.id, () => {});
  await shots.removeBook('book');
  assert.equal(shots.allowed('book', preview.id), false);
  assert.deepEqual(await readdir(dir), [`other_${other.id}.png`]);
});
