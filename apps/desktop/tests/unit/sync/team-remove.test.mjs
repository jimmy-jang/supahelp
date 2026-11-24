import assert from 'node:assert/strict';
import { test } from 'node:test';
import { publicCaseError } from '../../../src/main/features/cases/errors.ts';
import { TeamDocuments } from '../../../src/main/features/sync/documents.ts';
import { caseOperation } from '../../support/case-environment.mjs';

test('non-admin team removal says admins only, not the case-notes message', () => {
  const context = {
    generation: 1,
    accountId: 'member',
    context: { kind: 'team', workspaceId: 'workspace' },
  };
  let role = 'member';
  const queued = [];
  const sync = {
    guard: () => ({ workspaceId: 'workspace', accountId: 'member', role }),
    assertContext() {},
    caseRecord: () => ({ id: 'case-1', ownerId: 'member', entries: [] }),
    queue: (type, id) => queued.push([type, id]),
  };
  const docs = new TeamDocuments(sync, { assertContext: () => {} });
  const op = caseOperation(context);

  assert.throws(() => docs.remove('case-1', op), /remove-admin-only/);
  assert.match(
    publicCaseError(Error('remove-admin-only')),
    /Only workspace admins/,
  );
  assert.deepEqual(queued, []);

  role = 'admin';
  docs.remove('case-1', op);
  assert.deepEqual(queued, [['delete', 'case-1']]);
});
