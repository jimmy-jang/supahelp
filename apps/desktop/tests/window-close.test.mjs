import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import {
  closeBeforeQuit,
  protectUnsavedEdits,
} from '../src/main/window-close.ts';

test('quit cancellation keeps services live and a later accepted quit cleans up once', async () => {
  const window = new EventEmitter();
  window.webContents = new EventEmitter();
  window.isDestroyed = () => false;
  let discard = false,
    cleanups = 0,
    stays = 0;
  protectUnsavedEdits(window, () => discard);
  window.close = () => {
    const event = {
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
    };
    window.webContents.emit('will-prevent-unload', event);
    if (event.defaultPrevented) window.emit('closed');
  };
  closeBeforeQuit(
    window,
    () => cleanups++,
    () => stays++,
  );
  await new Promise(setImmediate);
  assert.equal(cleanups, 0);
  assert.equal(stays, 1);
  assert.equal(window.listenerCount('closed'), 0);
  discard = true;
  closeBeforeQuit(
    window,
    () => cleanups++,
    () => stays++,
  );
  await new Promise(setImmediate);
  assert.equal(cleanups, 1);
  assert.equal(stays, 1);
  assert.equal(window.webContents.listenerCount('will-prevent-unload'), 1);
});

test('repeated close requests share one pending decision and do not discard early', async () => {
  const window = new EventEmitter();
  window.webContents = new EventEmitter();
  window.isDestroyed = () => false;
  let decide,
    asked = 0,
    discarded = 0,
    closed = 0,
    stayed = 0;
  protectUnsavedEdits(
    window,
    () => {
      asked++;
      return new Promise((resolve) => (decide = resolve));
    },
    () => discarded++,
  );
  window.close = () => {
    const event = {
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
    };
    window.webContents.emit('will-prevent-unload', event);
    if (event.defaultPrevented) window.emit('closed');
  };
  closeBeforeQuit(
    window,
    () => closed++,
    () => stayed++,
  );
  window.close();
  assert.equal(asked, 1);
  assert.equal(discarded, 0);
  assert.equal(stayed, 0);
  decide(true);
  await new Promise(setImmediate);
  assert.equal(discarded, 1);
  assert.equal(closed, 1);
  assert.equal(stayed, 0);
});

test('a failed decision keeps the window open and allows another attempt', async () => {
  const window = new EventEmitter();
  window.webContents = new EventEmitter();
  window.isDestroyed = () => false;
  protectUnsavedEdits(
    window,
    async () => {
      throw Error('renderer unavailable');
    },
    () => assert.fail('discard'),
  );
  window.close = () =>
    window.webContents.emit('will-prevent-unload', { defaultPrevented: false });
  let stayed = 0;
  closeBeforeQuit(
    window,
    () => assert.fail('closed'),
    () => stayed++,
  );
  await new Promise(setImmediate);
  assert.equal(stayed, 1);
});

test('a clean close or no window permits quit without retaining veto handlers', () => {
  const window = new EventEmitter();
  window.webContents = new EventEmitter();
  window.close = () => window.emit('closed');
  let cleanups = 0;
  closeBeforeQuit(
    window,
    () => cleanups++,
    () => assert.fail('no veto'),
  );
  closeBeforeQuit(
    undefined,
    () => cleanups++,
    () => assert.fail('no window'),
  );
  assert.equal(cleanups, 2);
  assert.equal(window.webContents.listenerCount('will-prevent-unload'), 0);
});

test('quit completion never reads the destroyed BrowserWindow', () => {
  const window = new EventEmitter(),
    contents = new EventEmitter();
  let destroyed = false,
    finished = false;
  Object.defineProperty(window, 'webContents', {
    get() {
      if (destroyed) throw Error('Object has been destroyed');
      return contents;
    },
  });
  window.close = () => {
    destroyed = true;
    window.emit('closed');
  };
  closeBeforeQuit(
    window,
    () => {
      finished = true;
    },
    () => assert.fail('no veto'),
  );
  assert.equal(finished, true);
});
