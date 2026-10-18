import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { assertCoveragePolicySatisfied, coveragePolicy, coveragePolicyId } from '../scripts/coverage-policy.js';
import { summarizeCoverage } from '../scripts/coverage-report.js';
import { validateCanonical } from '../src/validation/validate-canonical.js';

test(`coverage policy documentation reference resolves to a README heading (${coveragePolicyId})`, async () => {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  const headingText = 'Editorial coverage and rarity policy';
  const headingAnchor = headingText.toLowerCase().replaceAll(' ', '-');

  assert.equal(coveragePolicyId, `README.md#${headingAnchor}`);
  assert.match(readme, /^## Editorial coverage and rarity policy$/m);

  const policyStart = readme.indexOf(`## ${headingText}`);
  const nextHeading = readme.indexOf('\n## ', policyStart + 1);
  const policySection = readme
    .slice(policyStart, nextHeading === -1 ? undefined : nextHeading)
    .replace(/\s+/g, ' ');
  for (const [tier, target] of Object.entries(coveragePolicy.rarity)) {
    assert.ok(
      policySection.includes(`| ${tier} | ${target.min * 100}–${target.max * 100}% |`),
      `README policy must document the ${tier} coverage target`,
    );
  }

  assert.ok(policySection.includes(`at least ${coveragePolicy.minimumPublicReal} judoka`));
  assert.ok(policySection.includes(`at least ${coveragePolicy.minimumCountries} countries`));
  assert.ok(policySection.includes(`country may represent more than ${coveragePolicy.maximumCountryShare * 100}%`));
  assert.ok(policySection.includes(`gender may represent more than ${coveragePolicy.maximumGenderShare * 100}%`));
  if (coveragePolicy.requireEveryWeightClass) {
    assert.ok(policySection.includes('Every listed weight category must be represented'));
  }
});

test(`canonical public catalogue satisfies ${coveragePolicyId}`, async () => {
  const { judoka, weights } = await validateCanonical();
  assertCoveragePolicySatisfied(summarizeCoverage(judoka), weights);
});
