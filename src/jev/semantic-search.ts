import type { Judoka } from "../domain/types.js";
import type { JevDecisionClient } from "./types.js";

export interface SemanticSearchResult { judoka: Judoka; relevance: number; }
export interface SemanticSearchResponse { model: string; usage: Record<string, unknown>; results: SemanticSearchResult[]; }
export interface SemanticJudokaSearcher { search(query: string, candidates: Judoka[]): Promise<SemanticSearchResponse>; }

/** Ranks a deliberately bounded, already-filtered candidate pool; it does not replace catalogue search. */
export class SemanticJudokaSearchService implements SemanticJudokaSearcher {
  constructor(private readonly client: JevDecisionClient, private readonly options: { maxCandidates?: number; minimumRelevance?: number } = {}) {
    if (options.maxCandidates !== undefined && (!Number.isInteger(options.maxCandidates) || options.maxCandidates < 1)) {
      throw new RangeError("maxCandidates must be a positive integer");
    }
    if (options.minimumRelevance !== undefined && (!Number.isFinite(options.minimumRelevance) || options.minimumRelevance < 0 || options.minimumRelevance > 1)) {
      throw new RangeError("minimumRelevance must be between 0 and 1");
    }
  }

  async search(query: string, candidates: Judoka[]): Promise<SemanticSearchResponse> {
    const maxCandidates = this.options.maxCandidates ?? 20;
    if (!query.trim()) throw new TypeError("query must be non-empty");
    if (query.length > 1_000) throw new RangeError("semantic search query must not exceed 1000 characters");
    if (candidates.length > maxCandidates) throw new RangeError(`semantic search accepts at most ${maxCandidates} candidates; narrow with catalogue filters first`);
    if (new TextEncoder().encode(JSON.stringify({ query, candidates })).byteLength > 64_000) {
      throw new RangeError("semantic search request exceeds the 64 KB JEV input limit");
    }
    const questions = Object.fromEntries(candidates.map((_, index) => [
      `relevance_${index}`,
      { type: "noul" as const, instructions: `Does \`candidates[${index}]\` semantically satisfy the user's \`query\`? Judge only the catalogue fields supplied; do not infer unstated facts.` },
    ]));
    if (candidates.length === 0) return { model: "not_called", usage: {}, results: [] };
    const result = await this.client.decide({ query, candidates }, questions);
    const minimum = this.options.minimumRelevance ?? 0.5;
    const ranked = candidates.map((judoka, index) => {
      const answer = result.answers[`relevance_${index}`];
      return { judoka, relevance: answer?.type === "noul" ? answer.noul : 0 };
    })
      .filter(item => item.relevance >= minimum)
      .sort((left, right) => right.relevance - left.relevance || (left.judoka.id < right.judoka.id ? -1 : left.judoka.id > right.judoka.id ? 1 : 0));
    return { model: result.model, usage: result.usage, results: ranked };
  }
}
