import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { maskCasePatterns } from '../src/main/features/cases/masking.ts';

const fixtures = JSON.parse(
  readFileSync(new URL('./support/case-masking.json', import.meta.url), 'utf8'),
);

test('pattern fixtures redact specified formats and preserve clean support facts', () => {
  for (const { text, masked } of fixtures.patterns) {
    assert.equal(maskCasePatterns(text), masked);
    assert.equal(
      maskCasePatterns(masked),
      masked,
      'pattern pass is idempotent',
    );
  }
  const technical = 'x'.repeat(7992) + '@invalid';
  assert.equal(maskCasePatterns(technical), technical);
});
