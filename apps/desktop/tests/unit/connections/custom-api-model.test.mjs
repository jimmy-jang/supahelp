import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  blankRow,
  credential,
  rowsToOperations,
} from '../../../src/renderer/features/settings/customApiModel.ts';

test('credential types become one header and value', () => {
  assert.deepEqual(credential('Bearer token', 'Bearer abc ', ''), {
    header: 'Authorization',
    key: 'Bearer abc',
  });
  assert.deepEqual(credential('API key header', 'k', ' '), {
    header: 'X-API-Key',
    key: 'k',
  });
  // No credential: nothing is sent, whatever was typed before switching.
  assert.deepEqual(credential('No authentication', 'abc', ''), {
    header: '',
    key: '',
  });
  assert.equal(
    credential('Basic auth', 'user:pässword', '').key,
    `Basic ${Buffer.from('user:pässword').toString('base64')}`,
  );
});

test('hand-written endpoints become operations and bad ones name the endpoint', () => {
  const { operations, error } = rowsToOperations([
    { ...blankRow(), path: '/customers/{id}', query: 'expand' },
    {
      ...blankRow(),
      method: 'POST',
      path: '/customers',
      body: 'name, email',
      readOnly: false,
    },
    blankRow(),
  ]);
  assert.equal(error, undefined);
  assert.deepEqual(
    operations.map((o) => o.name),
    ['get_customers_id', 'post_customers'],
  );
  assert.deepEqual(operations[0].inputSchema.required, ['id']);
  assert.deepEqual(operations[0].query, ['expand']);
  assert.deepEqual(Object.keys(operations[1].inputSchema.properties), [
    'name',
    'email',
  ]);
  assert.equal(operations[1].readOnly, false);
  for (const path of ['customers', '/a?b=1', '/../x', '/{bad-id}'])
    assert.match(
      rowsToOperations([{ ...blankRow(), path }]).error,
      /^Endpoint 1:/,
    );
  assert.match(
    rowsToOperations([{ ...blankRow(), path: '/a/{id}', query: 'id' }]).error,
    /twice/,
  );
});
