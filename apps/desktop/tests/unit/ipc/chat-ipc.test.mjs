import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isTrustedSender } from '../../../src/main/ipc/trusted-sender.ts';

test('rejects another window, subframes and untrusted renderer locations', () => {
  const mainFrame = {};
  const sender = { mainFrame, getURL: () => 'http://localhost:5173/' };
  const event = { sender, senderFrame: mainFrame };
  assert.equal(isTrustedSender(event, sender, 'http://localhost:5173/'), true);
  assert.equal(isTrustedSender(event, sender, 'http://localhost:5173'), true);
  assert.equal(
    isTrustedSender(
      { ...event, sender: { ...sender } },
      sender,
      'http://localhost:5173/',
    ),
    false,
  );
  assert.equal(
    isTrustedSender(
      { ...event, senderFrame: {} },
      sender,
      'http://localhost:5173/',
    ),
    false,
  );
  assert.equal(isTrustedSender(event, sender, 'https://example.com/'), false);
  assert.equal(
    isTrustedSender(event, undefined, 'http://localhost:5173/'),
    false,
  );
});
