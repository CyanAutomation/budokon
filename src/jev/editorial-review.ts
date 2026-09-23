import type { Judoka, Technique } from "../domain/types.js";
import type { JevAnswer, JevDecisionClient, JevQuestion } from "./types.js";

export interface EditorialEvidence { url: string; excerpt: string; }
export interface EditorialReviewInput { record: Judoka; evidence: EditorialEvidence[]; duplicateCandidates?: Judoka[]; techniques?: Technique[]; }
export interface EditorialReviewItem {
  answers: Record<string, JevAnswer>;
  recommendation: "ready_for_human_approval" | "needs_revision" | "needs_human_review";
  requiresHumanApproval: true;
}
export interface EditorialReviewResult extends EditorialReviewItem {
  model: string;
  usage: Record<string, unknown>;
}
export interface EditorialReviewBatchResult {
  model: string;
  usage: Record<string, unknown>;
  reviews: EditorialReviewItem[];
}
export interface EditorialReviewer {
  review(input: EditorialReviewInput): Promise<EditorialReviewResult>;
  reviewMany?(inputs: EditorialReviewInput[]): Promise<EditorialReviewBatchResult>;
}

const MAX_REVIEW_BYTES = 64_000;
export const MAX_EDITORIAL_REVIEW_BATCH_SIZE = 10;
const probability = (answer: JevAnswer | undefined) => answer?.type === "noul" ? answer.noul : 0;

function validateReviewInput(input: EditorialReviewInput): void {
  if (!input.record || typeof input.record !== "object" || Array.isArray(input.record)) throw new TypeError("record must be an object");
  if (typeof input.record.id !== "string" || !input.record.id || typeof input.record.slug !== "string" || !input.record.slug) {
    throw new TypeError("record must include a non-empty id and slug");
  }
  if (typeof input.record.bio !== "string" || input.record.bio.length > 8_000) throw new TypeError("record.bio must be a string of at most 8000 characters");
  if (!Array.isArray(input.record.signatureMoveIds) || input.record.signatureMoveIds.length > 20
    || !input.record.signatureMoveIds.every(id => typeof id === "string" && id.length > 0)) {
    throw new TypeError("record.signatureMoveIds must contain at most 20 non-empty IDs");
  }
  if (!Array.isArray(input.evidence) || input.evidence.length > 10
    || !input.evidence.every(item => {
      if (!item || typeof item.url !== "string" || typeof item.excerpt !== "string" || item.excerpt.length === 0 || item.excerpt.length > 4_000) return false;
      try { return new URL(item.url).protocol === "https:"; } catch { return false; }
    })) {
    throw new TypeError("evidence must contain at most 10 HTTPS source excerpts of 1–4000 characters");
  }
  if (input.duplicateCandidates !== undefined && (!Array.isArray(input.duplicateCandidates) || input.duplicateCandidates.length > 10)) {
    throw new RangeError("duplicateCandidates accepts at most 10 records");
  }
  if (input.techniques !== undefined && (!Array.isArray(input.techniques) || input.techniques.length > 20)) {
    throw new RangeError("techniques accepts at most 20 resolved records");
  }
  let serializedInput: string;
  try { serializedInput = JSON.stringify(input); }
  catch { throw new TypeError("review input must be JSON-serializable"); }
  if (new TextEncoder().encode(serializedInput).byteLength > MAX_REVIEW_BYTES) throw new RangeError("review input exceeds the 64 KB JEV request limit");
}

function questionsFor(input: EditorialReviewInput, statePath: string): Record<string, JevQuestion> {
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

function recommendation(input: EditorialReviewInput, answers: Record<string, JevAnswer>, threshold: number): EditorialReviewItem["recommendation"] {
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
  const resolvedTechniqueIds = new Set((input.techniques ?? []).map(technique => technique.id));
  const techniquesComplete = input.record.signatureMoveIds.every(id => resolvedTechniqueIds.has(id));
  return explicitReview || duplicateNeedsReview || !evidenceComplete ? "needs_human_review"
    : factualClaimsSupported && publishable && attributesCoherent && techniquesComplete
      ? "ready_for_human_approval" : "needs_revision";
}

/** Reviews supplied evidence without fetching sources or changing canonical data. */
export class EditorialReviewService implements EditorialReviewer {
  constructor(private readonly client: JevDecisionClient, private readonly threshold = 0.8) {
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new RangeError("review threshold must be between 0 and 1");
  }

  async review(input: EditorialReviewInput): Promise<EditorialReviewResult> {
    const batch = await this.reviewMany([input]);
    const first = batch.reviews[0];
    if (!first) throw new Error("JEV editorial review returned no result");
    return { model: batch.model, usage: batch.usage, ...first };
  }

  async reviewMany(inputs: EditorialReviewInput[]): Promise<EditorialReviewBatchResult> {
    if (!Array.isArray(inputs) || inputs.length === 0 || inputs.length > MAX_EDITORIAL_REVIEW_BATCH_SIZE) {
      throw new RangeError("reviewMany accepts between 1 and 10 proposals");
    }
    inputs.forEach(validateReviewInput);
    let serializedInputs: string;
    try { serializedInputs = JSON.stringify(inputs); }
    catch { throw new TypeError("review inputs must be JSON-serializable"); }
    if (new TextEncoder().encode(serializedInputs).byteLength > MAX_REVIEW_BYTES) throw new RangeError("review batch exceeds the 64 KB JEV request limit");

    const proposals = inputs.map(input => {
      const candidates = input.duplicateCandidates ?? [];
      const techniqueById = new Map((input.techniques ?? []).map(technique => [technique.id, technique]));
      const resolvedTechniques = input.record.signatureMoveIds.map(id => techniqueById.get(id)).filter((value): value is Technique => value !== undefined);
      return { record: input.record, evidence: input.evidence, duplicateCandidates: candidates, resolvedTechniques };
    });
    const questions: Record<string, JevQuestion> = {};
    const questionIds: string[][] = [];
    for (const [index, input] of inputs.entries()) {
      const prefix = inputs.length === 1 ? "" : `proposal_${index}__`;
      const statePath = inputs.length === 1 ? "proposal" : `proposals[${index}]`;
      const proposalQuestions = questionsFor(input, statePath);
      questionIds.push(Object.keys(proposalQuestions));
      for (const [id, question] of Object.entries(proposalQuestions)) questions[`${prefix}${id}`] = question;
    }
    const result = await this.client.decide(inputs.length === 1 ? proposals[0] : { proposals }, questions);
    const reviews = inputs.map((input, index) => {
      const prefix = inputs.length === 1 ? "" : `proposal_${index}__`;
      const answers = Object.fromEntries(questionIds[index].map(id => [id, result.answers[`${prefix}${id}`]])) as Record<string, JevAnswer>;
      return { answers, recommendation: recommendation(input, answers, this.threshold), requiresHumanApproval: true as const };
    });
    return { model: result.model, usage: result.usage, reviews };
  }
}
