import assert from 'node:assert/strict';
import test from 'node:test';
import { formatCoverageReport, summarizeCoverage } from '../scripts/coverage-report.mjs';
import { coverageViolations } from '../scripts/coverage-policy.mjs';

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
  assert.doesNotMatch(formatCoverageReport(summary), /Game-ready records/);
});

test('coverage policy reports unsupported rarity and representation imbalance', () => {
  const summary = summarizeCoverage(Array.from({ length: 20 }, (_, index) => ({
    personType: 'real', isHidden: false, gender: 'male', countryCode: 'JP', weightClass: '-60', rarity: 'Legendary', slug: `judoka-${index}`,
  })));
  const violations = coverageViolations(summary, [{ gender: 'male', categories: [{ weight: '-60' }] }]);
  assert.ok(violations.some(message => message.includes('countries')));
  assert.ok(violations.some(message => message.includes('male has')));
  assert.ok(violations.some(message => message.includes('Common is')));
  assert.ok(violations.some(message => message.includes('Legendary is')));
});
