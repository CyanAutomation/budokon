import type { Judoka } from "../domain/types.js";

function normalize(value: string): string {
  return value.normalize("NFD").replace(/\p{Mark}+/gu, "").toLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, " ").trim();
}

function identityTerms(record: Judoka): Set<string> {
  return new Set([record.slug, ...(record.legacySlugs ?? []), record.firstname, record.surname, `${record.firstname ?? ""} ${record.surname ?? ""}`, ...(record.aliases ?? [])]
    .flatMap(value => normalize(String(value ?? "")).split(/\s+/u))
    .filter(Boolean));
}

function duplicateScore(proposed: Judoka, candidate: Judoka): number {
  const proposedHandles = new Set([proposed.slug, ...(proposed.legacySlugs ?? [])]);
  if ([candidate.slug, ...(candidate.legacySlugs ?? [])].some(handle => proposedHandles.has(handle))) return 10;
  const proposalName = normalize(`${proposed.firstname ?? ""} ${proposed.surname ?? ""}`);
  const candidateName = normalize(`${candidate.firstname ?? ""} ${candidate.surname ?? ""}`);
  if (proposalName && proposalName === candidateName) return 10;
  const proposedTerms = identityTerms(proposed);
  const candidateTerms = identityTerms(candidate);
  const shared = [...proposedTerms].filter(term => candidateTerms.has(term)).length;
  const union = new Set([...proposedTerms, ...candidateTerms]).size;
  const nameScore = union ? shared / union : 0;
  const surnameScore = proposed.surname && candidate.surname && normalize(proposed.surname) === normalize(candidate.surname) ? 1.5 : 0;
  return nameScore + surnameScore;
}

/** Shortlist likely identity matches locally so JEV compares a small, relevant set. */
export function rankDuplicateCandidates(proposed: Judoka, candidates: Judoka[], limit = 10): Judoka[] {
  if (!Number.isInteger(limit) || limit < 0) throw new RangeError("duplicate shortlist limit must be a non-negative integer");
  return candidates.filter(candidate => candidate.id !== proposed.id)
    .map(candidate => ({ candidate, score: duplicateScore(proposed, candidate) }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || (left.candidate.id < right.candidate.id ? -1 : left.candidate.id > right.candidate.id ? 1 : 0))
    .slice(0, limit)
    .map(({ candidate }) => candidate);
}
