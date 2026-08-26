import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCanonical } from '../src/validation/validate-canonical.mjs';
import { coverageViolations, publicRealJudoka } from './coverage-policy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const orderedCounts = counts => Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));

function countBy(records, field) {
  const counts = {};
  for (const record of records) {
    const value = record[field];
    if (typeof value === 'string' && value) counts[value] = (counts[value] ?? 0) + 1;
  }
  return orderedCounts(counts);
}

/** Return a stable, descriptive snapshot to guide the next small curation batch. */
export function summarizeCoverage(judoka) {
  const publicReal = publicRealJudoka(judoka);
  return {
    total: judoka.length,
    publicReal: publicReal.length,
    hidden: judoka.filter(record => record.isHidden === true).length,
    byGender: countBy(publicReal, 'gender'),
    byCountry: countBy(publicReal, 'countryCode'),
    byWeightClass: countBy(publicReal, 'weightClass'),
    byRarity: countBy(publicReal, 'rarity'),
    byPersonType: countBy(judoka, 'personType'),
  };
}

const formatCounts = counts => Object.entries(counts).map(([key, count]) => `  ${key}: ${count}`).join('\n') || '  (none)';

export function formatCoverageReport(summary) {
  return [
    'BU-DO-KON editorial coverage',
    `Total judoka: ${summary.total}`,
    `Public real judoka: ${summary.publicReal}`,
    `Hidden judoka: ${summary.hidden}`,
    '', 'By gender', formatCounts(summary.byGender),
    '', 'By country', formatCounts(summary.byCountry),
    '', 'By weight class', formatCounts(summary.byWeightClass),
    '', 'By rarity (public real judoka)', formatCounts(summary.byRarity),
    '', 'By person type', formatCounts(summary.byPersonType),
  ].join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { judoka, weights } = await validateCanonical(root);
  const summary = summarizeCoverage(judoka);
  console.log(formatCoverageReport(summary));
  const violations = coverageViolations(summary, weights);
  if (violations.length) {
    console.error(`\nCoverage policy violations:\n${violations.map(message => `  - ${message}`).join('\n')}`);
    process.exitCode = 1;
  }
}
