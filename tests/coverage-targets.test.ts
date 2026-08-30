import test from 'node:test';
import { assertCoveragePolicySatisfied, coveragePolicyId } from '../scripts/coverage-policy.js';
import { summarizeCoverage } from '../scripts/coverage-report.js';
import { validateCanonical } from '../src/validation/validate-canonical.js';

test(`canonical public catalogue satisfies ${coveragePolicyId}`, async () => {
  const { judoka, weights } = await validateCanonical();
  assertCoveragePolicySatisfied(summarizeCoverage(judoka), weights);
});
