import type { Judoka } from "../domain/types.js";
import type { JevDecisionClient } from "./types.js";
import {
  createSemanticSearchQuestions,
  rankSemanticSearchResults,
  validateSemanticSearchOptions,
  validateSemanticSearchRequest,
} from "./semantic-search-policy.js";
import {
  DEFAULT_SEMANTIC_SEARCH_MAX_CANDIDATES,
  type SemanticJudokaSearcher,
  type SemanticSearchResponse,
} from "./semantic-search-contracts.js";

export {
  DEFAULT_SEMANTIC_SEARCH_MAX_CANDIDATES,
  MAX_SEMANTIC_SEARCH_CANDIDATES,
} from "./semantic-search-contracts.js";
export type {
  SemanticJudokaSearcher,
  SemanticSearchResponse,
  SemanticSearchResult,
} from "./semantic-search-contracts.js";

/** Ranks a bounded candidate pool, including the complete current catalogue; it does not replace deterministic search. */
export class SemanticJudokaSearchService implements SemanticJudokaSearcher {
  constructor(
    private readonly client: JevDecisionClient,
    private readonly options: { maxCandidates?: number; minimumRelevance?: number } = {},
  ) {
    validateSemanticSearchOptions(options);
  }

  async search(query: string, candidates: Judoka[]): Promise<SemanticSearchResponse> {
    const maxCandidates = this.options.maxCandidates ?? DEFAULT_SEMANTIC_SEARCH_MAX_CANDIDATES;
    validateSemanticSearchRequest(query, candidates, maxCandidates);
    const questions = createSemanticSearchQuestions(candidates);
    if (candidates.length === 0) return { model: "not_called", usage: {}, results: [] };

    const result = await this.client.decide({ query, candidates }, questions);
    const minimumRelevance = this.options.minimumRelevance ?? 0.5;
    return {
      model: result.model,
      usage: result.usage,
      results: rankSemanticSearchResults(candidates, result.answers, minimumRelevance),
    };
  }
}
