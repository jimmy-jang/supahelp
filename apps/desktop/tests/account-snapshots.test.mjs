import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  newerAccount,
  sameContext,
} from '../src/renderer/features/accounts/snapshots.ts';
test('renderer rejects old account generations even when their revision is newer', () => {
  const current = {
    revision: 2,
    context: { generation: 3, accountId: 'b', context: { kind: 'personal' } },
  };
  assert.equal(
    newerAccount(current, { revision: 100, context: { generation: 2 } }),
    false,
  );
  assert.equal(
    newerAccount(current, { revision: 1, context: { generation: 4 } }),
    true,
  );
  assert.equal(
    sameContext(current.context, { ...current.context, accountId: 'a' }),
    false,
  );
  assert.equal(sameContext(current.context, undefined), false);
  assert.equal(
    sameContext(current.context, structuredClone(current.context)),
    true,
  );
});
