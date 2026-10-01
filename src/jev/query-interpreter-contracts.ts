import type { Country, FilterField, Filters, WeightCategoryGroup } from "../domain/types.js";
import type { JevQuestion } from "./types.js";

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

export type FacetQuestion = [FilterField, Extract<JevQuestion, { type: "choice" }>];
