import assert from 'node:assert/strict';
import test from 'node:test';
import { formatCoverageReport, printCoverageReport, summarizeCoverage } from '../scripts/coverage-report.js';
import { assertCoveragePolicySatisfied, coverageViolations } from '../scripts/coverage-policy.js';

test('coverage summary reports the visible catalogue and its balance', () => {
  const summary = summarizeCoverage([
    { slug: 'current-star', personType: 'real', isHidden: false, gender: 'female', countryCode: 'FR', weightClass: '-63', stats: {}, rarity: 'Epic', signatureMoveIds: ['uchi-mata'], bio: 'A sufficiently long editorial biography.', profileUrl: 'https://example.test/current-star' },
    { slug: 'historic-star', personType: 'real', isHidden: false, gender: 'male', countryCode: 'JP', weightClass: '-81', stats: {}, rarity: 'Legendary', signatureMoveIds: ['seoi-nage'], bio: 'A sufficiently long editorial biography.', profileUrl: 'https://example.test/historic-star' },
    { slug: 'fictional', personType: 'fictional', isHidden: true, gender: 'male', countryCode: 'JP', weightClass: '+100' },
  ]);

  assert.deepEqual(summary, {
    total: 3,
    publicReal: 2,
    hidden: 1,
    byGender: { female: 1, male: 1 },
    byCountry: { FR: 1, JP: 1 },
    byWeightClass: { '-63': 1, '-81': 1 },
    byRarity: { Epic: 1, Legendary: 1 },
    byPersonType: { fictional: 1, real: 2 },
  });
  assert.match(formatCoverageReport(summary), /Public real judoka: 2/);
  assert.match(formatCoverageReport(summary), /By rarity/);
  assert.match(formatCoverageReport(summary), /Epic: 1 \(50\.0%\)/);
  assert.doesNotMatch(formatCoverageReport(summary), /Game-ready records/);
});

test('coverage report and policy violations use their respective channels without throwing', () => {
  const summary = summarizeCoverage([]);
  const weights = [{ gender: 'female', categories: [{ weight: '-48' }, { weight: '-52' }] }];
  const reports: string[] = [];
  const errors: string[] = [];
  const satisfied = printCoverageReport(summary, weights, {
    log: message => reports.push(message),
    error: message => errors.push(message),
  });

  assert.equal(satisfied, false);
  assert.deepEqual(reports, [formatCoverageReport(summary)]);
  assert.deepEqual(errors, [
    '\nCoverage policy violations (README.md#editorial-coverage-and-rarity-policy):\n'
      + '  - public real catalogue has 0; need at least 20\n'
      + '  - catalogue covers 0 countries; need at least 10\n'
      + '  - weight class -48 has no public real judoka\n'
      + '  - weight class -52 has no public real judoka',
  ]);
});

test('coverage policy reports every violation when the catalogue is too small', async (t) => {
  const records = [
    { personType: 'real', isHidden: false, gender: 'male', countryCode: 'JP', weightClass: '-60', rarity: 'Legendary', slug: 'first-judoka' },
    { personType: 'real', isHidden: false, gender: 'male', countryCode: 'JP', weightClass: '-60', rarity: 'Legendary', slug: 'second-judoka' },
  ];
  const weightCategories = [{ gender: 'male', categories: [{ weight: '-60' }] }];

  await t.test('catalogue size, country share, and weight-class completeness', () => {
    const violations = coverageViolations(summarizeCoverage([records[0]]), [{
      gender: 'male',
      categories: [{ weight: '-60' }, { weight: '-66' }],
    }], {
      minimumPublicReal: 2,
      minimumCountries: 1,
      maximumCountryShare: 0.5,
      maximumGenderShare: 1,
      requireEveryWeightClass: true,
      rarity: { Legendary: { min: 0, max: 1 } },
    });

    assert.deepEqual([...violations].sort(), [
      'JP has 100.0% of the catalogue; maximum is 50%',
      'public real catalogue has 1; need at least 2',
      'weight class -66 has no public real judoka',
    ].sort());

    assert.throws(
      () => assertCoveragePolicySatisfied(summarizeCoverage([records[0]]), [{
        gender: 'male',
        categories: [{ weight: '-60' }, { weight: '-66' }],
      }], {
        minimumPublicReal: 2,
        minimumCountries: 1,
        maximumCountryShare: 0.5,
        maximumGenderShare: 1,
        requireEveryWeightClass: true,
        rarity: { Legendary: { min: 0, max: 1 } },
      }),
      (error: Error) => violations.every(violation => error.message.includes(violation)),
    );
  });

  const cases = [
    {
      name: 'minimum country representation',
      policy: {
        minimumPublicReal: 0,
        minimumCountries: 2,
        maximumCountryShare: 1,
        maximumGenderShare: 1,
        requireEveryWeightClass: false,
        rarity: { Legendary: { min: 0, max: 1 } },
      },
      expected: ['catalogue covers 1 countries; need at least 2'],
    },
    {
      name: 'gender-share limits',
      policy: {
        minimumPublicReal: 0,
        minimumCountries: 1,
        maximumCountryShare: 1,
        maximumGenderShare: 0.5,
        requireEveryWeightClass: false,
        rarity: { Legendary: { min: 0, max: 1 } },
      },
      expected: ['male has 100.0% of the catalogue; maximum is 50%'],
    },
    {
      name: 'missing required rarity bands',
      policy: {
        minimumPublicReal: 0,
        minimumCountries: 1,
        maximumCountryShare: 1,
        maximumGenderShare: 1,
        requireEveryWeightClass: false,
        rarity: {
          Common: { min: 0.5, max: 1 },
          Legendary: { min: 0, max: 1 },
        },
      },
      expected: ['Common is 0.0%; target is 50-100%'],
    },
    {
      name: 'excessive rarity share',
      policy: {
        minimumPublicReal: 0,
        minimumCountries: 1,
        maximumCountryShare: 1,
        maximumGenderShare: 1,
        requireEveryWeightClass: false,
        rarity: { Legendary: { min: 0, max: 0.5 } },
      },
      expected: ['Legendary is 100.0%; target is 0-50%'],
    },
  ];

  for (const { name, policy, expected } of cases) {
    await t.test(name, () => {
      const violations = coverageViolations(summarizeCoverage(records), weightCategories, policy);
      assert.deepEqual([...violations].sort(), [...expected].sort());
    });
  }
});
