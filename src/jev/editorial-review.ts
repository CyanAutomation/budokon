import type { Judoka, Technique } from "../domain/types.js";
import type { JevAnswer, JevDecisionClient } from "./types.js";

export interface EditorialEvidence { url: string; excerpt: string; }
export interface EditorialReviewInput {
  record: Judoka;
  evidence: EditorialEvidence[];
  duplicateCandidates?: Judoka[];
  techniques?: Technique[];
}
export interface EditorialReviewResult {
  model: string;
  usage: Record<string, unknown>;
  answers: Record<string, JevAnswer>;
  recommendation: "ready_for_human_approval" | "needs_revision" | "needs_human_review";
  /** This is deliberately always true: JEV may advise but never edits canonical data. */
  requiresHumanApproval: true;
}
export interface EditorialReviewer { review(input: EditorialReviewInput): Promise<EditorialReviewResult>; }

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
  if (new TextEncoder().encode(serializedInput).byteLength > 64_000) throw new RangeError("review input exceeds the 64 KB JEV request limit");
}

/** Reviews a proposed record against supplied evidence without fetching sources or changing data. */
export class EditorialReviewService implements EditorialReviewer {
  constructor(private readonly client: JevDecisionClient, private readonly threshold = 0.8) {
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new RangeError("review threshold must be between 0 and 1");
  }

  async review(input: EditorialReviewInput): Promise<EditorialReviewResult> {
    validateReviewInput(input);
    const candidates = input.duplicateCandidates ?? [];
    const techniqueById = new Map((input.techniques ?? []).map(technique => [technique.id, technique]));
    const resolvedTechniques = input.record.signatureMoveIds.map(id => techniqueById.get(id)).filter((value): value is Technique => value !== undefined);
    const duplicateCriteria = Object.fromEntries([
      ["none", "None of the supplied candidates appears to be the same person."],
      ["uncertain", "There is not enough information to determine whether any candidate is the same person."],
      ...candidates.map(candidate => [candidate.id, `${candidate.firstname ?? ""} ${candidate.surname ?? ""} (${candidate.slug})`.trim()]),
    ]);
    const result = await this.client.decide({
      proposedRecord: input.record,
      evidence: input.evidence,
      duplicateCandidates: candidates,
      resolvedTechniques,
    }, {
      biography_publishable: { type: "noul", instructions: "Does `proposedRecord.bio` read as neutral, specific, publishable editorial biography text without invented claims or promotional language?" },
      factual_claims_supported: { type: "noul", instructions: "Based only on `evidence`, do the factual identity, nationality, weight-class, and biography claims in `proposedRecord` have adequate support? Treat a URL without an excerpt as no supporting evidence." },
      stats_coherent: { type: "noul", instructions: "Are the values in `proposedRecord.stats` plausible, internally consistent editorial game ratings on the 0–10 scale, without treating them as objective athlete rankings?" },
      rarity_appropriate: { type: "noul", instructions: "Does `proposedRecord.rarity` fit the catalogue policy: Common for broad/reliable profiles, Rare for notable specialists, Epic for major champions, and Legendary for exceptional era-defining records? Treat rarity as an editorial game choice, not a factual ranking." },
      signature_techniques_plausible: { type: "noul", instructions: "Are the techniques listed in `resolvedTechniques` coherent signature choices for `proposedRecord`, using only the supplied technique names and descriptions? If the technique details are missing, answer no." },
      duplicate_candidate: { type: "choice", instructions: "Which entry in `duplicateCandidates`, if any, is most likely the same person as `proposedRecord`? Choose uncertain if the supplied information is insufficient.", criteria: duplicateCriteria },
      human_review_recommended: { type: "noul", instructions: "Given `proposedRecord`, `evidence`, and `duplicateCandidates`, should an editor inspect this proposal before it can be added to the canonical catalogue?" },
    });
    const supported = probability(result.answers.factual_claims_supported) >= this.threshold;
    const publishable = probability(result.answers.biography_publishable) >= this.threshold;
    const attributesCoherent = ["stats_coherent", "rarity_appropriate", "signature_techniques_plausible"]
      .every(id => probability(result.answers[id]) >= this.threshold);
    const explicitReview = probability(result.answers.human_review_recommended) >= 0.5;
    const duplicate = result.answers.duplicate_candidate?.type === "choice" && result.answers.duplicate_candidate.choice !== "none";
    const evidenceComplete = input.evidence.length > 0;
    const techniquesComplete = resolvedTechniques.length === input.record.signatureMoveIds.length;
    return {
      ...result,
      recommendation: explicitReview || duplicate || !evidenceComplete ? "needs_human_review"
        : supported && publishable && attributesCoherent && techniquesComplete
          ? "ready_for_human_approval" : "needs_revision",
      requiresHumanApproval: true,
    };
  }
}
