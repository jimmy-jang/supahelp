import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  feedUrl,
  updatesSupported,
} from '../../../src/main/app/update-feed.ts';

const feed = 'https://updates.example.com/example/desktop';

test('updates require an HTTPS feed and a supported installed build', () => {
  assert.equal(updatesSupported('', true, 'darwin'), false);
  assert.equal(
    updatesSupported('http://updates.example.com', true, 'win32'),
    false,
  );
  assert.equal(updatesSupported(feed, true, 'darwin'), true);
  assert.equal(updatesSupported(feed, true, 'win32'), true);
  assert.equal(updatesSupported(feed, false, 'darwin'), false);
  assert.equal(updatesSupported(feed, true, 'linux'), false);
  assert.equal(updatesSupported(feed, true, 'win32', false), false);
});

test('feed url is per platform, arch and current version', () => {
  assert.equal(
    feedUrl(`${feed}/`, 'darwin', 'arm64', '1.0.0'),
    `${feed}/darwin-arm64/1.0.0`,
  );
});
