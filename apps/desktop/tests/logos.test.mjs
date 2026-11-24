import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { test } from 'node:test';
import { connectionCatalog } from '../src/renderer/fixtures/connections.ts';

test('every named connection has a bundled logo', async () => {
  const files = await readdir(
    new URL('../src/renderer/assets/connections/', import.meta.url),
  );
  const ids = new Set(files.map((file) => file.replace(/\.[^.]+$/, '')));
  for (const tool of connectionCatalog) {
    if (tool.id.startsWith('custom')) continue;
    assert.ok(ids.has(tool.id), `${tool.name} needs a bundled logo`);
  }
});
