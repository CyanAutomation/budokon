import type { Judoka } from "../domain/types.js";
import type { JevAnswer, JevQuestion } from "./types.js";
import { MAX_SEMANTIC_SEARCH_CANDIDATES } from "./semantic-search-contracts.js";
import type { SemanticSearchResult } from "./semantic-search-contracts.js";

export function validateSemanticSearchOptions(options: { maxCandidates?: number; minimumRelevance?: number }): void {
  if (options.maxCandidates !== undefined
    && (!Number.isInteger(options.maxCandidates) || options.maxCandidates < 1 || options.maxCandidates > MAX_SEMANTIC_SEARCH_CANDIDATES)) {
    throw new RangeError(`maxCandidates must be an integer between 1 and ${MAX_SEMANTIC_SEARCH_CANDIDATES}`);
  }
  if (options.minimumRelevance !== undefined
    && (!Number.isFinite(options.minimumRelevance) || options.minimumRelevance < 0 || options.minimumRelevance > 1)) {
    throw new RangeError("minimumRelevance must be between 0 and 1");
  }
}

export function validateSemanticSearchRequest(query: string, candidates: Judoka[], maxCandidates: number): void {
  if (!query.trim()) throw new TypeError("query must be non-empty");
  if (query.length > 1_000) throw new RangeError("semantic search query must not exceed 1000 characters");
  if (candidates.length > maxCandidates) {
    throw new RangeError(`semantic search accepts at most ${maxCandidates} candidates; narrow with catalogue filters first`);
  }
  const requestBytes = new TextEncoder().encode(JSON.stringify({ query, candidates })).byteLength;
  if (requestBytes > 64_000) throw new RangeError("semantic search request exceeds the 64 KB JEV input limit");
}

export function createSemanticSearchQuestions(candidates: Judoka[]): Record<string, JevQuestion> {
  return Object.fromEntries(candidates.map((_, index) => [
    `relevance_${index}`,
    { type: "noul" as const, instructions: `Does \`candidates[${index}]\` semantically satisfy the user's \`query\`? Judge only the catalogue fields supplied; do not infer unstated facts.` },
  ]));
}

export function rankSemanticSearchResults(
  candidates: Judoka[],
  answers: Record<string, JevAnswer>,
  minimumRelevance: number,
): SemanticSearchResult[] {
  return candidates.map((judoka, index) => {
    const answer = answers[`relevance_${index}`];
    return { judoka, relevance: answer?.type === "noul" ? answer.noul : 0 };
  })
    .filter(item => item.relevance >= minimumRelevance)
    .sort((left, right) => right.relevance - left.relevance || (left.judoka.id < right.judoka.id ? -1 : left.judoka.id > right.judoka.id ? 1 : 0));
}
