import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { CaseStore } from '../../../src/main/features/cases/store.ts';
import { CaseService } from '../../../src/main/features/cases/service.ts';
import {
  caseEnvironment,
  caseOperation,
} from '../../support/case-environment.mjs';

test('unknown legacy actor names cannot pass a masked-storage marker or acquire local ownership', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'supahelp-case-identity-')),
    file = join(home, 'cases.db'),
    state = caseEnvironment();
  const first = new CaseService(
    new CaseStore(file),
    () => {},
    state.environment,
  );
  const op = caseOperation();
  await first.create({ id: 'chat-a', title: 'Case', messages: [] }, op);
  first.close();
  const db = new DatabaseSync(file);
  db.exec('PRAGMA user_version = 1;');
  db.prepare('UPDATE cases SET owner_id = ?').run('Alex Example');
  db.close();
  const cases = new CaseService(
    new CaseStore(file),
    () => {},
    state.environment,
  );
  t.after(async () => {
    cases.close();
    await rm(home, { recursive: true, force: true });
  });
  await assert.rejects(cases.prepare(op), /case-recovery/);
  assert.deepEqual(cases.snapshot().cases, []);
  const retained = new DatabaseSync(file);
  assert.equal(
    retained.prepare('SELECT owner_id FROM cases').get().owner_id,
    'Alex Example',
  );
  assert.equal(retained.prepare('PRAGMA user_version').get().user_version, 1);
  retained.close();
});
