import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { windowConfirmation } from '../../../src/main/window-dialog.ts';

const setup = () => {
  const ipc = new EventEmitter();
  const window = new EventEmitter();
  const contents = (window.webContents = new EventEmitter());
  contents.mainFrame = {};
  contents.getURL = () => 'file:///app/index.html';
  let request;
  contents.send = (channel, id) => {
    assert.equal(channel, 'window:close-requested');
    request = id;
  };
  const ask = windowConfirmation(ipc, window, contents.getURL());
  const reply = (accepted, overrides = {}, id = request) =>
    ipc.emit(
      'window:close-response',
      {
        sender: contents,
        senderFrame: contents.mainFrame,
        ...overrides,
      },
      { id, accepted },
    );
  return { ask, reply, ipc, contents, window };
};

test('only the current main-frame request can authorize closing', async () => {
  const s = setup();
  const pending = s.ask();
  assert.equal(await s.ask(), false);
  let settled = false;
  void pending.then(() => (settled = true));
  s.reply(true, { senderFrame: {} });
  s.reply(true, { sender: {} });
  s.reply(true, {}, 'stale-id');
  s.reply('true');
  await Promise.resolve();
  assert.equal(settled, false);
  s.reply(false);
  assert.equal(await pending, false);
  const accepted = s.ask();
  s.reply(true);
  assert.equal(await accepted, true);
});

test('renderer reload/crash cancels pending consent; close removes IPC listeners', async () => {
  const s = setup();
  const first = s.ask();
  s.contents.emit(
    'did-start-navigation',
    {},
    'file:///app/index.html',
    false,
    true,
  );
  assert.equal(await first, false);
  const next = s.ask();
  s.contents.emit('render-process-gone');
  assert.equal(await next, false);
  const last = s.ask();
  s.window.emit('closed');
  assert.equal(await last, false);
  assert.equal(s.ipc.listenerCount('window:close-response'), 0);
});
