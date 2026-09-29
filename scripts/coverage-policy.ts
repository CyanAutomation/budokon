/** Editorial guardrails for the public, real-judoka draw pool. */
export type CountMap = Record<string, number>;

export interface CoverageSummary {
  publicReal: number;
  byCountry: CountMap;
  byGender: CountMap;
  byWeightClass: CountMap;
  byRarity: CountMap;
}

export interface CoveragePolicy {
  minimumPublicReal: number;
  minimumCountries: number;
  maximumCountryShare: number;
  maximumGenderShare: number;
  requireEveryWeightClass: boolean;
  rarity: Readonly<Record<string, Readonly<{ min: number; max: number }>>>;
}

/** Stable reference to the human-readable policy enforced by this module. */
export const coveragePolicyId = 'README.md#editorial-coverage-and-rarity-policy';

const coveragePolicy: Readonly<CoveragePolicy> = Object.freeze({
  minimumPublicReal: 20,
  minimumCountries: 10,
  maximumCountryShare: 0.35,
  maximumGenderShare: 0.6,
  requireEveryWeightClass: true,
  rarity: Object.freeze({
    Common: Object.freeze({ min: 0.25, max: 0.45 }),
    Rare: Object.freeze({ min: 0.2, max: 0.4 }),
    Epic: Object.freeze({ min: 0.15, max: 0.3 }),
    Legendary: Object.freeze({ min: 0.05, max: 0.2 }),
  }),
});

export function publicRealJudoka(judoka) {
  return judoka.filter(record => record.personType === 'real' && record.isHidden !== true);
}

function catalogueSizeViolations(summary: CoverageSummary, policy: Readonly<CoveragePolicy>): string[] {
  const violations = [];
  if (summary.publicReal < policy.minimumPublicReal) {
    violations.push(`public real catalogue has ${summary.publicReal}; need at least ${policy.minimumPublicReal}`);
  }
  const countryCount = Object.keys(summary.byCountry).length;
  if (countryCount < policy.minimumCountries) violations.push(`catalogue covers ${countryCount} countries; need at least ${policy.minimumCountries}`);
  return violations;
}

function shareViolations(counts: CountMap, publicReal: number, maximum: number): string[] {
  return Object.entries(counts)
    .filter(([, count]) => count / publicReal > maximum)
    .map(([label, count]) => `${label} has ${(count / publicReal * 100).toFixed(1)}% of the catalogue; maximum is ${maximum * 100}%`);
}

function weightClassViolations(weightCategories, summary: CoverageSummary, policy: Readonly<CoveragePolicy>): string[] {
  if (!policy.requireEveryWeightClass) return [];
  const violations = [];
  for (const group of weightCategories) {
    for (const { weight } of group.categories) {
      if (!summary.byWeightClass[weight]) violations.push(`weight class ${weight} has no public real judoka`);
    }
  }
  return violations;
}

function rarityViolations(summary: CoverageSummary, policy: Readonly<CoveragePolicy>): string[] {
  const violations = [];
  for (const [rarity, target] of Object.entries(policy.rarity)) {
    const share = (summary.byRarity[rarity] ?? 0) / summary.publicReal;
    if (share < target.min || share > target.max) violations.push(`${rarity} is ${(share * 100).toFixed(1)}%; target is ${target.min * 100}-${target.max * 100}%`);
  }
  return violations;
}

export function coverageViolations(summary: CoverageSummary, weightCategories, policy: Readonly<CoveragePolicy> = coveragePolicy) {
  return [
    ...catalogueSizeViolations(summary, policy),
    ...shareViolations(summary.byCountry, summary.publicReal, policy.maximumCountryShare),
    ...shareViolations(summary.byGender, summary.publicReal, policy.maximumGenderShare),
    ...weightClassViolations(weightCategories, summary, policy),
    ...rarityViolations(summary, policy),
  ];
}

/** Format policy violations as one actionable diagnostic. */
export function formatCoverageViolations(violations: readonly string[]) {
  return `Coverage policy violations (${coveragePolicyId}):\n${violations.map(message => `  - ${message}`).join('\n')}`;
}

/** Fail a gate with every policy violation included in one actionable diagnostic. */
export function assertCoveragePolicySatisfied(
  summary: CoverageSummary,
  weightCategories,
  policy: Readonly<CoveragePolicy> = coveragePolicy,
) {
  const violations = coverageViolations(summary, weightCategories, policy);
  if (violations.length) {
    throw new Error(formatCoverageViolations(violations));
  }
}
