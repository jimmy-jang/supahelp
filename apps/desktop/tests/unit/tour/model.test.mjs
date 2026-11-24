import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  finishKind,
  placeTourCard,
  TOUR_STEPS,
  tourDecision,
} from '../../../src/renderer/features/tour/model.ts';

const state = { seen: false, loaded: true, hasWork: false, onHome: true };

test('the tour starts only for a new person on Home after their work has loaded', () => {
  assert.equal(tourDecision(state), 'start');
  assert.equal(tourDecision({ ...state, seen: undefined }), 'wait');
  assert.equal(tourDecision({ ...state, seen: true }), 'wait');
  assert.equal(tourDecision({ ...state, loaded: false }), 'wait');
  assert.equal(tourDecision({ ...state, onHome: false }), 'wait');
});

test('people upgrading with existing work never get the first-run tour', () => {
  assert.equal(tourDecision({ ...state, hasWork: true }), 'retire');
  assert.equal(
    tourDecision({ ...state, hasWork: true, onHome: false }),
    'retire',
  );
  assert.equal(
    tourDecision({ ...state, hasWork: true, loaded: false }),
    'wait',
    'an unloaded list cannot prove the person is new',
  );
});

test('the finish card asks for the first missing setup step', () => {
  assert.equal(finishKind(false, 'missing'), 'model');
  assert.equal(finishKind(false, 'connected'), 'model');
  assert.equal(finishKind(true, 'missing'), 'helpdesk');
  assert.equal(finishKind(true, 'connected'), 'ready');
  assert.equal(finishKind(true, 'none'), 'ready');
});

test('the card uses the preferred side and points at the target', () => {
  const placed = placeTourCard(
    { x: 300, y: 200, width: 400, height: 100 },
    { width: 340, height: 200 },
    { width: 1440, height: 900 },
    'right',
  );
  assert.equal(placed.side, 'right');
  assert.equal(placed.x, 714);
  assert.ok(placed.arrow >= 14 && placed.arrow <= 174);
});

test('the card moves to a side that fits', () => {
  const placed = placeTourCard(
    { x: 700, y: 100, width: 240, height: 80 },
    { width: 340, height: 200 },
    { width: 960, height: 640 },
    'right',
  );
  assert.equal(placed.side, 'bottom');
  assert.ok(placed.x + 340 <= 948);
});

test('when no side fits, the card stays in the window and clear of left-side actions', () => {
  const target = { x: 272, y: 0, width: 688, height: 640 };
  const placed = placeTourCard(
    target,
    { width: 340, height: 200 },
    { width: 960, height: 640 },
    'left',
  );
  assert.equal(placed.side, 'inside');
  assert.ok(placed.x >= 12 && placed.x + 340 <= 948);
  assert.ok(placed.y >= 12 && placed.y + 200 <= 628);
  assert.ok(placed.x > target.x + target.width / 2 - 340);
});

test('the tour teaches five steps and only sample actions can be tried', () => {
  assert.deepEqual(
    TOUR_STEPS.map((step) => step.n),
    [1, 2, 3, 4, 5],
  );
  assert.match(TOUR_STEPS[3].doneIt, /No refund was made/);
});
