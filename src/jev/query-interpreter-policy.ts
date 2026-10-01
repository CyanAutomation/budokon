import type { FilterField, Filters } from "../domain/types.js";
import type { JevAnswer, JevQuestion } from "./types.js";
import type { FacetQuestion, QueryFilterSuggestion } from "./query-interpreter-contracts.js";

const anyValue = "any";

export function interpretFacetAnswers(
  facets: FacetQuestion[],
  questions: Record<string, JevQuestion>,
  answers: Record<string, JevAnswer>,
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
