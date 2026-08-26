import type { CoverageResponse, Judoka } from "./types.js";

const orderedCounts = (counts: Record<string, number>) => Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));

function countBy(records: Judoka[], field: "gender" | "countryCode" | "weightClass" | "rarity") {
  const counts: Record<string, number> = {};
  for (const record of records) {
    const value = record[field];
    if (typeof value === "string" && value) counts[value] = (counts[value] ?? 0) + 1;
  }
  return orderedCounts(counts);
}

/** Summarize only the public, real-athlete draw pool used by consumer games. */
export function summarizeCoverage(judoka: Judoka[]): CoverageResponse {
  const publicJudoka = judoka.filter(record => record.personType === "real" && record.isHidden !== true);
  const byRarity = countBy(publicJudoka, "rarity");
  const rarityPercentages = publicJudoka.length > 0 ? Object.fromEntries(Object.entries(byRarity).map(([rarity, count]) => [rarity, Number((count / publicJudoka.length * 100).toFixed(1))])) : {};
  return {
    total: judoka.length,
    publicReal: publicJudoka.length,
    hidden: judoka.filter(record => record.isHidden === true).length,
    byGender: countBy(publicJudoka, "gender"),
    byCountry: countBy(publicJudoka, "countryCode"),
    byWeightClass: countBy(publicJudoka, "weightClass"),
    byRarity,
    rarityPercentages,
  };
}
