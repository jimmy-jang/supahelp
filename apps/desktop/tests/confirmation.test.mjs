import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createConfirmation } from '../src/renderer/components/confirmation.ts';

test('a decision resolves only its own request; duplicate prompts are cancelled', async () => {
  let shown;
  const confirmation = createConfirmation((request) => (shown = request));
  const first = confirmation.ask({
    title: 'Discard?',
    description: 'Text',
    action: 'Discard',
  });
  const request = shown;
  assert.equal(await confirmation.ask({ title: 'Another?' }), false);
  confirmation.answer({}, true);
  assert.equal(shown, request);
  confirmation.answer(request, false);
  assert.equal(await first, false);
  assert.equal(shown, undefined);
  const second = confirmation.ask({ title: 'Remove?' });
  confirmation.answer(request, true);
  confirmation.answer(shown, true);
  assert.equal(await second, true);
});

test('unmount/context cancellation rejects pending work and leaves no stale decision', async () => {
  let shown;
  const confirmation = createConfirmation((request) => (shown = request));
  const pending = confirmation.ask({ title: 'Discard?' });
  const stale = shown;
  confirmation.cancel();
  assert.equal(await pending, false);
  const next = confirmation.ask({ title: 'New context' });
  confirmation.answer(stale, true);
  confirmation.cancel();
  assert.equal(await next, false);
});
