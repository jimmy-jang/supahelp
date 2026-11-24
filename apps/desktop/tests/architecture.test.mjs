import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const app = fileURLToPath(new URL('../', import.meta.url));
const directory = mkdtempSync(path.join(tmpdir(), 'supahelp-boundaries-'));
writeFileSync(
  path.join(directory, '.oxlintrc.json'),
  readFileSync(path.join(app, '.oxlintrc.json')),
);
after(() => rmSync(directory, { recursive: true, force: true }));

const examples = [
  ['renderer', 'react', true],
  ['renderer', '../../contracts/case', true],
  ['renderer', 'electron', false],
  ['renderer', 'electron/renderer', false],
  ['renderer', 'node:fs', false],
  ['renderer', 'fs/promises', false],
  ['renderer', '../../main/window', false],
  ['renderer', '../../preload/preload', false],
  ['main', 'electron', true],
  ['main', 'node:fs', true],
  ['main', '../contracts/case', true],
  ['main', '../renderer/App', false],
  ['main', '../preload/preload', false],
  ['preload', 'electron', true],
  ['preload', '../contracts/case', true],
  ['preload', 'node:fs', false],
  ['preload', '../main/window', false],
  ['preload', '../renderer/App', false],
  ['contracts', './case', true],
  ['contracts', 'react', false],
  ['contracts', 'electron', false],
  ['contracts', 'node:fs', false],
  ['contracts', '../main/window', false],
  ['contracts', '../preload/preload', false],
  ['contracts', '../renderer/App', false],
];

for (const [area, specifier, allowed] of examples) {
  test(`${area} ${allowed ? 'allows' : 'rejects'} ${specifier}`, () => {
    const file = path.join(directory, 'src', area, 'probe.ts');
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `import '${specifier}';\n`);
    const result = spawnSync(
      process.execPath,
      [path.join(app, 'node_modules/oxlint/bin/oxlint'), file],
      { cwd: directory, encoding: 'utf8' },
    );
    assert.ifError(result.error);
    const output = `${result.stdout}${result.stderr}`;
    assert.equal(result.status, allowed ? 0 : 1, output);
    if (!allowed) {
      assert.match(output, /no-restricted-imports|no-nodejs-modules/);
    }
  });
}
