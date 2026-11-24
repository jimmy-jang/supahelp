import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  canCheck,
  nextUpdateState,
} from '../../../src/main/app/update-state.ts';

const at = (status) => ({ version: '1.0.0', status });

test('unsupported builds ignore updater events until marked supported', () => {
  assert.equal(
    nextUpdateState(at('unsupported'), 'checking').status,
    'unsupported',
  );
  assert.equal(nextUpdateState(at('unsupported'), 'supported').status, 'idle');
});

test('check, download, ready follows the squirrel events', () => {
  let state = nextUpdateState(at('idle'), 'checking');
  assert.equal(state.status, 'checking');
  state = nextUpdateState(state, 'available');
  assert.equal(state.status, 'downloading');
  state = nextUpdateState(state, 'downloaded', 5);
  assert.deepEqual(state, { version: '1.0.0', status: 'ready', checkedAt: 5 });
});

test('no update records the check time; errors can be retried', () => {
  const current = nextUpdateState(at('checking'), 'none', 7);
  assert.deepEqual(current, {
    version: '1.0.0',
    status: 'current',
    checkedAt: 7,
  });
  const failed = nextUpdateState(at('checking'), 'error', 9);
  assert.equal(failed.status, 'error');
  assert.equal(canCheck(failed), true);
});

test('a downloaded update is never downgraded by a later event', () => {
  const ready = at('ready');
  for (const event of ['checking', 'none', 'error'])
    assert.equal(nextUpdateState(ready, event), ready);
});

test('checks are skipped while busy, ready or unsupported', () => {
  for (const status of ['unsupported', 'checking', 'downloading', 'ready'])
    assert.equal(canCheck(at(status)), false);
  for (const status of ['idle', 'current', 'error'])
    assert.equal(canCheck(at(status)), true);
});
