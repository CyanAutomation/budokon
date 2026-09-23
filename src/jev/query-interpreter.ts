import type { Country, FilterField, Filters, WeightCategoryGroup } from "../domain/types.js";
import type { JevDecisionClient, JevQuestion } from "./types.js";

export interface JudokaQueryFacets {
  countries: Record<string, Country>;
  weightCategories: WeightCategoryGroup[];
}
export interface QueryFilterSuggestion { value: string; confidence: number; applied: boolean; }
export interface JudokaQueryInterpretation {
  model: string;
  usage: Record<string, unknown>;
  filters: Filters;
  suggestions: Partial<Record<FilterField, QueryFilterSuggestion>>;
}
export interface JudokaQueryInterpreter {
  interpret(query: string, facets: JudokaQueryFacets): Promise<JudokaQueryInterpretation>;
}

const anyValue = "any";
const byCodeUnit = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;

/** Maps natural-language catalogue requests to existing deterministic filter fields. */
export class JevJudokaQueryInterpreter implements JudokaQueryInterpreter {
  private readonly minimumConfidence: number;

  constructor(private readonly client: JevDecisionClient, options: { minimumConfidence?: number } = {}) {
    this.minimumConfidence = options.minimumConfidence ?? 0.7;
    if (!Number.isFinite(this.minimumConfidence) || this.minimumConfidence < 0 || this.minimumConfidence > 1) {
      throw new RangeError("minimumConfidence must be between 0 and 1");
    }
  }

  async interpret(query: string, facets: JudokaQueryFacets): Promise<JudokaQueryInterpretation> {
    if (!query.trim()) throw new TypeError("query must be non-empty");
    const countryCriteria = Object.fromEntries([
      [anyValue, "The query does not specify a country or nationality."],
      ...Object.values(facets.countries)
        .filter(country => country.active)
        .sort((left, right) => byCodeUnit(left.code, right.code))
        .map(country => [country.code, `${country.country} (country code ${country.code})`]),
    ]);
    const weightDescriptions = new Map<string, string[]>();
    for (const group of facets.weightCategories) {
      for (const category of group.categories) {
        if (!category || typeof category !== "object" || Array.isArray(category)) continue;
        const value = category as { weight?: unknown; descriptor?: unknown };
        if (typeof value.weight !== "string" || typeof value.descriptor !== "string") continue;
        const descriptions = weightDescriptions.get(value.weight) ?? [];
        descriptions.push(`${group.gender}: ${value.descriptor}`);
        weightDescriptions.set(value.weight, descriptions);
      }
    }
    const weightCriteria = Object.fromEntries([
      [anyValue, "The query does not specify a weight category."],
      ...[...weightDescriptions.entries()].sort(([left], [right]) => byCodeUnit(left, right))
        .map(([weight, descriptions]) => [weight, `${weight} kg category (${descriptions.join("; ")})`]),
    ]);
    const facetQuestions: Array<[FilterField, Extract<JevQuestion, { type: "choice" }>]> = [
      ["countryCode", { type: "choice", instructions: "Which country, if any, does the user's catalogue query specify? Choose any when none is specified.", criteria: countryCriteria }],
      ["gender", { type: "choice", instructions: "Which gender, if any, does the user's catalogue query specify? Choose any when none is specified.", criteria: { any: "No gender specified.", male: "Men's judo category.", female: "Women's judo category." } }],
      ["weightClass", { type: "choice", instructions: "Which exact judo weight category, if any, does the user's query specify? Choose any when no category is clear.", criteria: weightCriteria }],
      ["rarity", { type: "choice", instructions: "Which catalogue rarity, if any, does the user's query request? Choose any when none is specified.", criteria: { any: "No rarity specified.", Common: "Common game rarity.", Rare: "Rare game rarity.", Epic: "Epic game rarity.", Legendary: "Legendary game rarity." } }],
      ["personType", { type: "choice", instructions: "Does the user's query request real or fictional judoka? Choose any when it does not specify.", criteria: { any: "No person type specified.", real: "Real judoka.", fictional: "Fictional judoka." } }],
    ];
    const questions = Object.fromEntries(facetQuestions.filter(([, question]) => Object.keys(question.criteria).length > 1)) as Record<string, JevQuestion>;
    const availableCatalogueFilters = Object.fromEntries(facetQuestions.map(([field, question]) => [field, question.criteria]));
    const result = await this.client.decide({ query, availableCatalogueFilters }, questions);
    const filters: Filters = {};
    const suggestions: Partial<Record<FilterField, QueryFilterSuggestion>> = {};
    for (const [field] of facetQuestions) {
      if (!questions[field]) continue;
      const answer = result.answers[field];
      if (answer?.type !== "choice") continue;
      const applied = answer.choice !== anyValue && answer.confidence >= this.minimumConfidence;
      suggestions[field] = { value: answer.choice, confidence: answer.confidence, applied };
      if (applied) filters[field] = answer.choice;
    }
    return { model: result.model, usage: result.usage, filters, suggestions };
  }
}
