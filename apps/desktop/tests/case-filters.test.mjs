import assert from 'node:assert/strict';
import { test } from 'node:test';
import { filterCases } from '../src/renderer/features/cases/filterCases.ts';

const caseRow = (id, ownerId, contributorIds = []) => ({
  id,
  title: 'Billing issue',
  customer: 'Brightway',
  ticket: 'ZD #123',
  doc: { ownerId, contributorIds },
});
const cases = [
  caseRow('owned', 'local', ['local']),
  caseRow('helping', 'colleague', ['local']),
  caseRow('other', 'colleague'),
];
const ids = (rows) => rows.map((c) => c.id);

test('Mine selects the local owner; Contributing selects only others you help', () => {
  assert.deepEqual(ids(filterCases(cases, 'Mine', 'local', '')), ['owned']);
  assert.deepEqual(ids(filterCases(cases, 'Contributing', 'local', '')), [
    'helping',
  ]);
  assert.deepEqual(filterCases(cases, 'All cases', 'local', ''), cases);
});

test('ownership uses the supplied identity without assuming the preview user', () => {
  assert.deepEqual(ids(filterCases(cases, 'Mine', 'colleague', '')), [
    'helping',
    'other',
  ]);
  for (const filter of ['Mine', 'Contributing']) {
    assert.deepEqual(filterCases(cases, filter, null, ''), []);
    assert.deepEqual(filterCases([], filter, 'local', ''), []);
  }
});

test('search narrows the selected filter and preserves incoming order', () => {
  for (const query of ['  BILLING ', 'brightway', 'ZD #123']) {
    assert.deepEqual(ids(filterCases(cases, 'Mine', 'local', query)), [
      'owned',
    ]);
  }
  assert.deepEqual(filterCases(cases, 'All cases', 'local', 'missing'), []);
  assert.deepEqual(ids(cases), ['owned', 'helping', 'other']);
});

test('search matches current owner and contributor names and emails', () => {
  const people = [
    { id: 'colleague', name: 'Renamed Owner', email: 'owner@example.test' },
    { id: 'local', name: 'Case Contributor', email: 'help@example.test' },
  ];
  assert.deepEqual(
    ids(filterCases(cases, 'All cases', 'local', 'renamed owner', people)),
    ['helping', 'other'],
  );
  assert.deepEqual(
    ids(
      filterCases(cases, 'Contributing', 'local', 'HELP@example.test', people),
    ),
    ['helping'],
  );
});
