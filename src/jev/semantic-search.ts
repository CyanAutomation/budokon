import type { Judoka } from "../domain/types.js";
import type { JevDecisionClient } from "./types.js";

export interface SemanticSearchResult { judoka: Judoka; relevance: number; }
export interface SemanticSearchResponse { model: string; usage: Record<string, unknown>; results: SemanticSearchResult[]; }
export interface SemanticJudokaSearcher { search(query: string, candidates: Judoka[]): Promise<SemanticSearchResponse>; }

/** Ranks a deliberately bounded, already-filtered candidate pool; it does not replace catalogue search. */
export class SemanticJudokaSearchService implements SemanticJudokaSearcher {
  constructor(private readonly client: JevDecisionClient, private readonly options: { maxCandidates?: number; minimumRelevance?: number } = {}) {}

  async search(query: string, candidates: Judoka[]): Promise<SemanticSearchResponse> {
    const maxCandidates = this.options.maxCandidates ?? 20;
    if (!query.trim()) throw new TypeError("query must be non-empty");
    if (candidates.length > maxCandidates) throw new RangeError(`semantic search accepts at most ${maxCandidates} candidates; narrow with catalogue filters first`);
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
      .sort((left, right) => right.relevance - left.relevance || left.judoka.id.localeCompare(right.judoka.id));
    return { model: result.model, usage: result.usage, results: ranked };
  }
}
