/** Editorial guardrails for the public, real-judoka draw pool. */
export const coveragePolicy = Object.freeze({
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

export function coverageViolations(summary, weightCategories, policy = coveragePolicy) {
  const violations = [];
  const { publicReal } = summary;
  if (publicReal < policy.minimumPublicReal) return [`public real catalogue has ${publicReal}; need at least ${policy.minimumPublicReal}`];
  if (Object.keys(summary.byCountry).length < policy.minimumCountries) violations.push(`catalogue covers ${Object.keys(summary.byCountry).length} countries; need at least ${policy.minimumCountries}`);
  for (const [country, count] of Object.entries(summary.byCountry)) if (count / publicReal > policy.maximumCountryShare) violations.push(`${country} has ${(count / publicReal * 100).toFixed(1)}% of the catalogue; maximum is ${policy.maximumCountryShare * 100}%`);
  for (const [gender, count] of Object.entries(summary.byGender)) if (count / publicReal > policy.maximumGenderShare) violations.push(`${gender} has ${(count / publicReal * 100).toFixed(1)}% of the catalogue; maximum is ${policy.maximumGenderShare * 100}%`);
  if (policy.requireEveryWeightClass) for (const group of weightCategories) for (const { weight } of group.categories) if (!summary.byWeightClass[weight]) violations.push(`weight class ${weight} has no public real judoka`);
  for (const [rarity, target] of Object.entries(policy.rarity)) {
    const share = (summary.byRarity[rarity] ?? 0) / publicReal;
    if (share < target.min || share > target.max) violations.push(`${rarity} is ${(share * 100).toFixed(1)}%; target is ${target.min * 100}-${target.max * 100}%`);
  }
  return violations;
}
