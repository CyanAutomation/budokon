import type { Judoka } from "../domain/types.js";

export interface SemanticSearchResult { judoka: Judoka; relevance: number; }
export interface SemanticSearchResponse { model: string; usage: Record<string, unknown>; results: SemanticSearchResult[]; }
export interface SemanticJudokaSearcher { search(query: string, candidates: Judoka[]): Promise<SemanticSearchResponse>; }
export const MAX_SEMANTIC_SEARCH_CANDIDATES = 100;
export const DEFAULT_SEMANTIC_SEARCH_MAX_CANDIDATES = MAX_SEMANTIC_SEARCH_CANDIDATES;
