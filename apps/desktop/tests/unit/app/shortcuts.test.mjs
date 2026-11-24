import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  hasCommandKey,
  shortcutLabel,
} from '../../../src/renderer/components/shortcuts.ts';

const keys = (value) => ({
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  ...value,
});

test('shortcut labels match the platform', () => {
  assert.equal(shortcutLabel('N', 'MacIntel'), '⌘N');
  assert.equal(shortcutLabel('N', 'Win32'), 'Ctrl+N');
});

test('Command drives shortcuts on Mac and Ctrl elsewhere, but AltGr does not', () => {
  assert.equal(hasCommandKey(keys({ metaKey: true }), 'MacIntel'), true);
  assert.equal(hasCommandKey(keys({ ctrlKey: true }), 'MacIntel'), false);
  assert.equal(hasCommandKey(keys({ ctrlKey: true }), 'Win32'), true);
  assert.equal(hasCommandKey(keys({ metaKey: true }), 'Win32'), false);
  assert.equal(
    hasCommandKey(keys({ ctrlKey: true, altKey: true }), 'Win32'),
    false,
  );
});
