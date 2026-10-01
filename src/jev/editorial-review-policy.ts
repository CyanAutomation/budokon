import type { Judoka, Technique } from "../domain/types.js";
import type { JevAnswer, JevQuestion } from "./types.js";
import type { EditorialReviewInput, EditorialReviewItem } from "./editorial-review-contracts.js";

const MAX_REVIEW_BYTES = 64_000;
const probability = (answer: JevAnswer | undefined) => answer?.type === "noul" ? answer.noul : 0;

function validateReviewRecord(record: Judoka): void {
  if (!record || typeof record !== "object" || Array.isArray(record)) throw new TypeError("record must be an object");
  if (typeof record.id !== "string" || !record.id || typeof record.slug !== "string" || !record.slug) {
    throw new TypeError("record must include a non-empty id and slug");
  }
  if (typeof record.bio !== "string" || record.bio.length > 8_000) throw new TypeError("record.bio must be a string of at most 8000 characters");
  if (!Array.isArray(record.signatureMoveIds) || record.signatureMoveIds.length > 20
    || !record.signatureMoveIds.every(id => typeof id === "string" && id.length > 0)) {
    throw new TypeError("record.signatureMoveIds must contain at most 20 non-empty IDs");
  }
}

function isValidEvidenceItem(item: unknown): boolean {
  if (!item || typeof item !== "object" || Array.isArray(item)) return false;
  const evidence = item as Record<string, unknown>;
  if (typeof evidence.url !== "string" || typeof evidence.excerpt !== "string" || evidence.excerpt.length === 0 || evidence.excerpt.length > 4_000) return false;
  try { return new URL(evidence.url).protocol === "https:"; }
  catch { return false; }
}

function validateReviewEvidence(evidence: EditorialReviewInput["evidence"]): void {
  if (!Array.isArray(evidence) || evidence.length > 10 || !evidence.every(isValidEvidenceItem)) {
    throw new TypeError("evidence must contain at most 10 HTTPS source excerpts of 1–4000 characters");
  }
}

function validateOptionalReviewLimits(input: EditorialReviewInput): void {
  if (input.duplicateCandidates !== undefined && (!Array.isArray(input.duplicateCandidates) || input.duplicateCandidates.length > 10)) {
    throw new RangeError("duplicateCandidates accepts at most 10 records");
  }
  if (input.techniques !== undefined && (!Array.isArray(input.techniques) || input.techniques.length > 20)) {
    throw new RangeError("techniques accepts at most 20 resolved records");
  }
}

function validateReviewInputSize(input: EditorialReviewInput): void {
  let serializedInput: string;
  try { serializedInput = JSON.stringify(input); }
  catch { throw new TypeError("review input must be JSON-serializable"); }
  if (new TextEncoder().encode(serializedInput).byteLength > MAX_REVIEW_BYTES) throw new RangeError("review input exceeds the 64 KB JEV request limit");
}

export function validateEditorialReviewInput(input: EditorialReviewInput): void {
  validateReviewRecord(input.record);
  validateReviewEvidence(input.evidence);
  validateOptionalReviewLimits(input);
  validateReviewInputSize(input);
}

export function createEditorialReviewQuestions(input: EditorialReviewInput, statePath: string): Record<string, JevQuestion> {
  const candidates = input.duplicateCandidates ?? [];
  const duplicateCriteria = Object.fromEntries([
    ["none", "None of the supplied candidates appears to be the same person."],
    ["uncertain", "There is not enough information to determine whether any candidate is the same person."],
    ...candidates.map(candidate => [candidate.id, `${candidate.firstname ?? ""} ${candidate.surname ?? ""} (${candidate.slug})`.trim()]),
  ]);
  const questions: Record<string, JevQuestion> = {
    biography_publishable: { type: "noul", instructions: `Does \`${statePath}.record.bio\` read as neutral, specific, publishable editorial biography text without invented claims or promotional language?` },
    identity_supported: { type: "noul", instructions: `Based only on \`${statePath}.evidence\`, is the identity and name in \`${statePath}.record\` adequately supported?` },
    nationality_supported: { type: "noul", instructions: `Based only on \`${statePath}.evidence\`, is the nationality in \`${statePath}.record.countryCode\` adequately supported?` },
    weight_class_supported: { type: "noul", instructions: `Based only on \`${statePath}.evidence\`, is the weight class in \`${statePath}.record.weightClass\` adequately supported?` },
    biography_claims_supported: { type: "noul", instructions: `Based only on \`${statePath}.evidence\`, are the factual claims in \`${statePath}.record.bio\` adequately supported?` },
    factual_claims_supported: { type: "noul", instructions: `Considering identity, nationality, weight class, and biography, are the factual claims in \`${statePath}.record\` adequately supported by \`${statePath}.evidence\`? A URL without an excerpt is not evidence.` },
    stats_coherent: { type: "noul", instructions: `Are the values in \`${statePath}.record.stats\` plausible, internally consistent editorial game ratings on the 0–10 scale, without treating them as objective athlete rankings?` },
    rarity_appropriate: { type: "noul", instructions: `Does \`${statePath}.record.rarity\` fit the catalogue policy: Common for broad/reliable profiles, Rare for notable specialists, Epic for major champions, and Legendary for exceptional era-defining records? Treat rarity as an editorial game choice, not a factual ranking.` },
    signature_techniques_plausible: { type: "noul", instructions: `Are the techniques listed in \`${statePath}.resolvedTechniques\` coherent signature choices for \`${statePath}.record\`, using only the supplied technique names and descriptions? If the technique details are missing, answer no.` },
    human_review_recommended: { type: "noul", instructions: `Given \`${statePath}\`, should an editor inspect this proposal before it can be added to the canonical catalogue?` },
  };
  if (candidates.length > 0) {
    questions.duplicate_candidate = {
      type: "choice",
      instructions: `Which entry in \`${statePath}.duplicateCandidates\`, if any, is most likely the same person as \`${statePath}.record\`? Choose uncertain if the supplied information is insufficient.`,
      criteria: duplicateCriteria,
    };
  }
  return questions;
}

export function editorialReviewRecommendation(
  input: EditorialReviewInput,
  answers: Record<string, JevAnswer>,
  threshold: number,
): EditorialReviewItem["recommendation"] {
  const factualClaimsSupported = ["identity_supported", "nationality_supported", "weight_class_supported", "biography_claims_supported", "factual_claims_supported"]
    .every(id => probability(answers[id]) >= threshold);
  const publishable = probability(answers.biography_publishable) >= threshold;
  const attributesCoherent = ["stats_coherent", "rarity_appropriate", "signature_techniques_plausible"]
    .every(id => probability(answers[id]) >= threshold);
  const explicitReview = probability(answers.human_review_recommended) >= 0.5;
  const duplicateAnswer = answers.duplicate_candidate;
  const duplicateNeedsReview = duplicateAnswer?.type === "choice"
    && (duplicateAnswer.choice !== "none" || duplicateAnswer.confidence < threshold);
  const evidenceComplete = input.evidence.length > 0;
  const resolvedTechniqueIds = new Set((input.techniques ?? []).map((technique: Technique) => technique.id));
  const techniquesComplete = input.record.signatureMoveIds.every(id => resolvedTechniqueIds.has(id));
  return explicitReview || duplicateNeedsReview || !evidenceComplete ? "needs_human_review"
    : factualClaimsSupported && publishable && attributesCoherent && techniquesComplete
      ? "ready_for_human_approval" : "needs_revision";
}
