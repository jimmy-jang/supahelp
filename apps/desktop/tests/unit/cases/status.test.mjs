import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CaseService } from '../../../src/main/features/cases/service.ts';
import { CaseStore } from '../../../src/main/features/cases/store.ts';
import {
  caseEnvironment,
  caseOperation,
} from '../../support/case-environment.mjs';

// Live statuses come from chats and actions; only the Waiting ones are picked.
test('case status: live from chats/actions, manual Waiting, Resolved sticks', async () => {
  const { environment } = caseEnvironment();
  let emits = 0;
  const cases = new CaseService(
    new CaseStore(':memory:'),
    () => emits++,
    environment,
  );
  const op = () => caseOperation(environment.context());
  const id = await cases.create(
    { id: 'chat-1', title: 'Refund', messages: [] },
    op(),
  );
  const live = { actions: [], chats: [{ id: 'chat-1', status: 'idle' }] };
  cases.liveInputs = () => live;
  const shown = () => cases.snapshot().cases.find((c) => c.id === id).status;

  assert.equal(shown(), 'inv');
  cases.setStatus(id, 'wcust', op());
  assert.equal(shown(), 'wcust');
  assert.throws(() => cases.setStatus(id, 'appr', op()), /invalid-entry/);

  live.chats = [{ id: 'chat-1', status: 'running' }];
  assert.equal(shown(), 'run');
  live.chats = [{ id: 'chat-1', status: 'idle', error: 'boom' }];
  assert.equal(shown(), 'fail');
  live.actions = [
    { chatId: 'other', source: { caseId: id }, status: 'unknown' },
  ];
  assert.equal(shown(), 'unk');
  live.actions.push({ chatId: 'chat-1', status: 'pending' });
  assert.equal(shown(), 'appr');
  // Stored status is untouched, so Resolve's change checks don't see it.
  assert.equal(cases.read(id, op()).status, 'wcust');

  // refresh() re-sends only when a live input changed.
  emits = 0;
  cases.refresh();
  cases.refresh();
  assert.equal(emits, 1);

  live.actions = [];
  live.chats = [];
  cases.store.setResolved(id, true, new Date().toISOString());
  live.chats = [{ id: 'chat-1', status: 'running' }];
  assert.equal(shown(), 'done');
  assert.throws(() => cases.setStatus(id, 'weng', op()), /case-resolved/);
});
