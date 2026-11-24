import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  actionFields,
  toolTitle,
} from '../src/renderer/features/chat/action-fields.ts';

test('humanizes tool names', () => {
  assert.equal(toolTitle('create_google_doc'), 'Create Google Doc');
  assert.equal(toolTitle('updateIssue'), 'Update Issue');
  assert.equal(toolTitle('get_ticket_url'), 'Get Ticket URL');
});

test('labels and splits fields by value type', () => {
  const text = 'Summary\n\nDemo refund requests are reviewed.';
  assert.deepEqual(
    actionFields('create_google_doc', { name: 'Refund policy', text }),
    [
      { label: 'Title', text: 'Refund policy', long: false },
      { label: 'Content', text, long: true },
    ],
  );
  assert.deepEqual(
    actionFields('create_issue', {
      file_id: 'abc',
      urgent: true,
      labels: ['bug', 'p1'],
      empty: '',
      gone: null,
      assignee: { user_id: 7 },
    }),
    [
      { label: 'File ID', text: 'abc', long: false },
      { label: 'Urgent', text: 'Yes', long: false },
      { label: 'Labels', items: ['bug', 'p1'] },
      {
        label: 'Assignee',
        fields: [{ label: 'User ID', text: '7', long: false }],
      },
    ],
  );
});
