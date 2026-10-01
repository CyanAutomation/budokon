import type { Country, WeightCategoryGroup } from "../domain/types.js";
import type { JevQuestion } from "./types.js";
import type { FacetQuestion, JudokaQueryFacets } from "./query-interpreter-contracts.js";

const anyValue = "any";
const byCodeUnit = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;

function countryCriteria(countries: Record<string, Country>): Record<string, string> {
  return Object.fromEntries([
    [anyValue, "The query does not specify a country or nationality."],
    ...Object.values(countries)
      .filter(country => country.active)
      .sort((left, right) => byCodeUnit(left.code, right.code))
      .map(country => [country.code, `${country.country} (country code ${country.code})`]),
  ]);
}

function weightCriteria(groups: WeightCategoryGroup[]): Record<string, string> {
  const descriptions = new Map<string, string[]>();
  for (const group of groups) {
    for (const category of group.categories) {
      if (!category || typeof category !== "object" || Array.isArray(category)) continue;
      const value = category as { weight?: unknown; descriptor?: unknown };
      if (typeof value.weight !== "string" || typeof value.descriptor !== "string") continue;
      const entries = descriptions.get(value.weight) ?? [];
      entries.push(`${group.gender}: ${value.descriptor}`);
      descriptions.set(value.weight, entries);
    }
  }
  return Object.fromEntries([
    [anyValue, "The query does not specify a weight category."],
    ...[...descriptions.entries()].sort(([left], [right]) => byCodeUnit(left, right))
      .map(([weight, entries]) => [weight, `${weight} kg category (${entries.join("; ")})`]),
  ]);
}

export function createFacetQuestions(facets: JudokaQueryFacets): FacetQuestion[] {
  return [
    ["countryCode", { type: "choice", instructions: "Which country, if any, does the user's catalogue query specify? Choose any when none is specified.", criteria: countryCriteria(facets.countries) }],
    ["gender", { type: "choice", instructions: "Which gender, if any, does the user's catalogue query specify? Choose any when none is specified.", criteria: { any: "No gender specified.", male: "Men's judo category.", female: "Women's judo category." } }],
    ["weightClass", { type: "choice", instructions: "Which exact judo weight category, if any, does the user's query specify? Choose any when no category is clear.", criteria: weightCriteria(facets.weightCategories) }],
    ["rarity", { type: "choice", instructions: "Which catalogue rarity, if any, does the user's query request? Choose any when none is specified.", criteria: { any: "No rarity specified.", Common: "Common game rarity.", Rare: "Rare game rarity.", Epic: "Epic game rarity.", Legendary: "Legendary game rarity." } }],
    ["personType", { type: "choice", instructions: "Does the user's query request real or fictional judoka? Choose any when it does not specify.", criteria: { any: "No person type specified.", real: "Real judoka.", fictional: "Fictional judoka." } }],
  ];
}

export function availableFacetQuestions(facets: FacetQuestion[]): Record<string, JevQuestion> {
  return Object.fromEntries(facets.filter(([, question]) => Object.keys(question.criteria).length > 1));
}

export function catalogueFilterCriteria(facets: FacetQuestion[]) {
  return Object.fromEntries(facets.map(([field, question]) => [field, question.criteria]));
}
