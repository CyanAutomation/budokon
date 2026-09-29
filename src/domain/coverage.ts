import type { CoverageResponse, Judoka } from "./types.js";
import { countStringField } from "./coverage-counts.js";

/** Summarize only the public, real-athlete draw pool used by consumer games. */
export function summarizeCoverage(judoka: Judoka[]): CoverageResponse {
  const publicJudoka = judoka.filter(record => record.personType === "real" && record.isHidden !== true);
  const byRarity = countStringField(publicJudoka, "rarity");
  const rarityPercentages = publicJudoka.length > 0 ? Object.fromEntries(Object.entries(byRarity).map(([rarity, count]) => [rarity, Number((count / publicJudoka.length * 100).toFixed(1))])) : {};
  return {
    total: judoka.length,
    publicReal: publicJudoka.length,
    hidden: judoka.filter(record => record.isHidden === true).length,
    byGender: countStringField(publicJudoka, "gender"),
    byCountry: countStringField(publicJudoka, "countryCode"),
    byWeightClass: countStringField(publicJudoka, "weightClass"),
    byRarity,
    rarityPercentages,
  };
}
