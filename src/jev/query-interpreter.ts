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

type FacetQuestion = [FilterField, Extract<JevQuestion, { type: "choice" }>];

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

function facetQuestions(facets: JudokaQueryFacets): FacetQuestion[] {
  return [
    ["countryCode", { type: "choice", instructions: "Which country, if any, does the user's catalogue query specify? Choose any when none is specified.", criteria: countryCriteria(facets.countries) }],
    ["gender", { type: "choice", instructions: "Which gender, if any, does the user's catalogue query specify? Choose any when none is specified.", criteria: { any: "No gender specified.", male: "Men's judo category.", female: "Women's judo category." } }],
    ["weightClass", { type: "choice", instructions: "Which exact judo weight category, if any, does the user's query specify? Choose any when no category is clear.", criteria: weightCriteria(facets.weightCategories) }],
    ["rarity", { type: "choice", instructions: "Which catalogue rarity, if any, does the user's query request? Choose any when none is specified.", criteria: { any: "No rarity specified.", Common: "Common game rarity.", Rare: "Rare game rarity.", Epic: "Epic game rarity.", Legendary: "Legendary game rarity." } }],
    ["personType", { type: "choice", instructions: "Does the user's query request real or fictional judoka? Choose any when it does not specify.", criteria: { any: "No person type specified.", real: "Real judoka.", fictional: "Fictional judoka." } }],
  ];
}

function availableQuestions(facets: FacetQuestion[]): Record<string, JevQuestion> {
  return Object.fromEntries(facets.filter(([, question]) => Object.keys(question.criteria).length > 1));
}

function interpretAnswers(
  facets: FacetQuestion[],
  questions: Record<string, JevQuestion>,
  answers: Record<string, import("./types.js").JevAnswer>,
  minimumConfidence: number,
) {
  const filters: Filters = {};
  const suggestions: Partial<Record<FilterField, QueryFilterSuggestion>> = {};
  for (const [field] of facets) {
    if (!questions[field]) continue;
    const answer = answers[field];
    if (answer?.type !== "choice") continue;
    const applied = answer.choice !== anyValue && answer.confidence >= minimumConfidence;
    suggestions[field] = { value: answer.choice, confidence: answer.confidence, applied };
    if (applied) filters[field] = answer.choice;
  }
  return { filters, suggestions };
}

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
    const choices = facetQuestions(facets);
    const questions = availableQuestions(choices);
    const availableCatalogueFilters = Object.fromEntries(choices.map(([field, question]) => [field, question.criteria]));
    const result = await this.client.decide({ query, availableCatalogueFilters }, questions);
    const { filters, suggestions } = interpretAnswers(choices, questions, result.answers, this.minimumConfidence);
    return { model: result.model, usage: result.usage, filters, suggestions };
  }
}
