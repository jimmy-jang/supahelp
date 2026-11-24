import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportPlaybook } from '../src/main/features/playbooks/export.ts';
import {
  safePlaybookLink,
  screenshotIds,
} from '../src/contracts/playbook-markdown.ts';

test('export writes portable Markdown and companion images without overwriting old assets', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'playbook-export-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'procedure.md');
  await writeFile(path, 'previous');
  const content = {
    title: 'Procedure',
    markdown: '## Check\n\n![Reviewed](playbook-image:image-1)',
  };
  await exportPlaybook(
    path,
    content,
    async () => Buffer.from('pixels'),
    () => {},
  );
  const markdown = await readFile(path, 'utf8');
  assert.match(markdown, /^# Procedure/);
  assert.ok(!markdown.includes('playbook-image:'));
  const assets = (await readdir(dir)).find((name) => name.includes('.assets-'));
  assert.equal(
    await readFile(join(dir, assets, 'image-1.png'), 'utf8'),
    'pixels',
  );
  await exportPlaybook(
    path,
    content,
    async () => Buffer.from('new'),
    () => {},
  );
  assert.equal(
    await readFile(join(dir, assets, 'image-1.png'), 'utf8'),
    'pixels',
  );
});

test('cancellation and image failure preserve destination and clean newly created files', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'playbook-export-cancel-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'procedure.md');
  await writeFile(path, 'keep');
  const content = {
    title: 'Procedure',
    markdown: '![Reviewed](playbook-image:image-1)',
  };
  await assert.rejects(
    exportPlaybook(
      path,
      content,
      async () => {
        throw Error('image unavailable');
      },
      () => {},
    ),
  );
  let current = true;
  await assert.rejects(
    exportPlaybook(
      path,
      content,
      async () => {
        current = false;
        return Buffer.from('pixels');
      },
      () => {
        if (!current) throw Error('context changed');
      },
    ),
  );
  assert.equal(await readFile(path, 'utf8'), 'keep');
  assert.deepEqual(await readdir(dir), ['procedure.md']);
});

test('Markdown links allow web URLs only and managed image IDs cannot traverse paths', () => {
  for (const value of [
    'javascript:alert(1)',
    'file:///etc/passwd',
    'data:text/html,test',
    '//example.com',
    'https://user:pass@example.com',
  ])
    assert.equal(safePlaybookLink(value), undefined);
  assert.equal(
    safePlaybookLink('https://example.com/help'),
    'https://example.com/help',
  );
  assert.throws(
    () => screenshotIds('![](playbook-image:../../secrets)'),
    /invalid-screenshot/,
  );
  assert.deepEqual(
    screenshotIds('![](playbook-image:one)\n![](playbook-image:one)'),
    ['one'],
  );
});

test('export preserves distinct image IDs that share a prefix and safe paths for any filename', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'playbook-prefix-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'procedure (team).md');
  await exportPlaybook(
    path,
    {
      title: 'Procedure',
      markdown: '![](playbook-image:one)\n![](playbook-image:one-two)',
    },
    async (id) => Buffer.from(id),
    () => {},
  );
  const text = await readFile(path, 'utf8');
  assert.match(text, /\/one\.png\)/);
  assert.match(text, /\/one-two\.png\)/);
  assert.ok(!/!\[\]\([^\n]*\(team\)/.test(text));
});
