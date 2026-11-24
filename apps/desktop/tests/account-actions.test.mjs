import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConnectionActions } from '../src/main/features/connections/actions.ts';

test('a different Supahelp account cannot approve or mark another accounts action checked', async () => {
  let principal = 'account-a',
    calls = 0;
  const receipts = [];
  const actions = new ConnectionActions(
    'Fixture',
    () => receipts,
    async () => {},
    () => {},
    () => ({ principal }),
  );
  const pending = actions
    .run(
      'chat',
      {
        name: 'write',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false },
      },
      {},
      () => {},
      async () => {
        calls++;
        return { content: [{ type: 'text', text: 'done' }] };
      },
    )
    .catch(() => {});
  await new Promise((r) => setImmediate(r));
  principal = 'account-b';
  let denied = false;
  try {
    await actions.decide(receipts[0].id, 'approve');
  } catch {
    denied = true;
  }
  actions.cancelAll();
  await pending;
  assert.equal(denied, true);
  assert.equal(calls, 0);
  receipts[0].status = 'unknown';
  await assert.rejects(actions.decide(receipts[0].id, 'checked'));
  assert.equal(receipts[0].status, 'unknown');
});

test('money-moving tools wait for chat approval even when marked read only; reads do not', async () => {
  const { requiresApproval } =
    await import('../src/main/features/connections/actions.ts');
  const tool = (name, readOnlyHint) => ({
    name,
    inputSchema: { type: 'object' },
    annotations: { readOnlyHint },
  });
  for (const name of [
    'refund_charge',
    'createPayout',
    'issue-credit',
    'transfer_funds',
  ])
    assert.equal(requiresApproval(tool(name, true)), true, name);
  for (const name of [
    'get_charge',
    'list_refunds',
    'searchInvoices',
    'get_record',
  ])
    assert.equal(requiresApproval(tool(name, true)), false, name);
  assert.equal(requiresApproval(tool('add_note', false)), true);

  const receipts = [];
  let calls = 0;
  const actions = new ConnectionActions(
    'Fixture',
    () => receipts,
    async () => {},
    () => {},
  );
  const run = actions.run(
    'chat',
    {
      ...tool('refund_charge', true),
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
    {},
    () => {},
    async () => {
      calls++;
      return { content: [{ type: 'text', text: 'done' }] };
    },
  );
  await new Promise((r) => setImmediate(r));
  assert.equal(calls, 0);
  assert.equal(receipts[0].status, 'pending');
  await actions.decide(receipts[0].id, 'approve');
  await run;
  assert.equal(calls, 1);
});
