import assert from 'node:assert/strict';
import test from 'node:test';
import { coverageViolations } from '../scripts/coverage-policy.mjs';
import { summarizeCoverage } from '../scripts/coverage-report.mjs';
import { validateCanonical } from '../src/validation/validate-canonical.mjs';

test('canonical public catalogue meets editorial coverage targets', async () => {
  const { judoka, weights } = await validateCanonical();
  assert.deepEqual(coverageViolations(summarizeCoverage(judoka), weights), []);
});
