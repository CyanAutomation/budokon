import assert from 'node:assert/strict';
import test from 'node:test';
import { coverageViolations } from '../scripts/coverage-policy.js';
import { summarizeCoverage } from '../scripts/coverage-report.js';
import { validateCanonical } from '../src/validation/validate-canonical.js';

test('canonical public catalogue meets editorial coverage targets', async () => {
  const { judoka, weights } = await validateCanonical();
  assert.deepEqual(coverageViolations(summarizeCoverage(judoka), weights), []);
});
