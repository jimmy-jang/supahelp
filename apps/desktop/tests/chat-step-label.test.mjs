import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stepLabel } from '../src/renderer/features/chat/step-label.ts';

test('names the connected tool a reply is using', () => {
  assert.deepEqual(stepLabel({ server: 'helpscout', tool: 'list' }), {
    text: 'Using Help Scout…',
    logo: 'helpscout',
  });
  assert.equal(
    stepLabel({ server: 'github_issues', tool: 'x' }).logo,
    'github-issues',
  );
  assert.equal(
    stepLabel({ server: 'supahelp-case', tool: 'read_case' }).text,
    'Reading the case…',
  );
  assert.equal(stepLabel({ server: 'acme', tool: 'x' }).text, 'Using Acme…');
});
