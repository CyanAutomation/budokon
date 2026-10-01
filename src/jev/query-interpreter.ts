import type { JevDecisionClient } from "./types.js";
import {
  availableFacetQuestions,
  catalogueFilterCriteria,
  createFacetQuestions,
} from "./query-interpreter-facets.js";
import { interpretFacetAnswers } from "./query-interpreter-policy.js";
import type {
  JudokaQueryFacets,
  JudokaQueryInterpretation,
  JudokaQueryInterpreter,
} from "./query-interpreter-contracts.js";

export type {
  JudokaQueryFacets,
  JudokaQueryInterpretation,
  JudokaQueryInterpreter,
  QueryFilterSuggestion,
} from "./query-interpreter-contracts.js";

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
    const choices = createFacetQuestions(facets);
    const questions = availableFacetQuestions(choices);
    const availableCatalogueFilters = catalogueFilterCriteria(choices);
    const result = await this.client.decide({ query, availableCatalogueFilters }, questions);
    const { filters, suggestions } = interpretFacetAnswers(choices, questions, result.answers, this.minimumConfidence);
    return { model: result.model, usage: result.usage, filters, suggestions };
  }
}
