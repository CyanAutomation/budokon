import type { Judoka } from "../domain/types.js";
import type { JevAnswer, JevDecisionClient } from "./types.js";

export interface EditorialEvidence { url: string; excerpt: string; }
export interface EditorialReviewInput { record: Judoka; evidence: EditorialEvidence[]; duplicateCandidates?: Judoka[]; }
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

/** Reviews a proposed record against supplied evidence without fetching sources or changing data. */
export class EditorialReviewService implements EditorialReviewer {
  constructor(private readonly client: JevDecisionClient, private readonly threshold = 0.8) {}

  async review(input: EditorialReviewInput): Promise<EditorialReviewResult> {
    const candidates = (input.duplicateCandidates ?? []).slice(0, 10);
    const duplicateCriteria = Object.fromEntries([["none", "None of the supplied candidates appears to be the same person."], ...candidates.map(candidate => [candidate.id, `${candidate.firstname ?? ""} ${candidate.surname ?? ""} (${candidate.slug})`.trim()])]);
    const result = await this.client.decide({ proposedRecord: input.record, evidence: input.evidence, duplicateCandidates: candidates }, {
      biography_publishable: { type: "noul", instructions: "Does `proposedRecord.bio` read as neutral, specific, publishable editorial biography text without invented claims or promotional language?" },
      factual_claims_supported: { type: "noul", instructions: "Based only on `evidence`, do the factual identity, nationality, weight-class, and biography claims in `proposedRecord` have adequate support?" },
      editorial_attributes_consistent: { type: "noul", instructions: "Are the editorial game attributes in `proposedRecord`, including rarity, stats, and signature techniques, internally coherent and intentionally chosen for a game profile? This is an advisory editorial judgement, not a factual claim." },
      duplicate_candidate: { type: "choice", instructions: "Which entry in `duplicateCandidates`, if any, is most likely the same person as `proposedRecord`?", criteria: duplicateCriteria },
      human_review_recommended: { type: "noul", instructions: "Given `proposedRecord`, `evidence`, and `duplicateCandidates`, should an editor inspect this proposal before it can be added to the canonical catalogue?" },
    });
    const supported = probability(result.answers.factual_claims_supported) >= this.threshold;
    const publishable = probability(result.answers.biography_publishable) >= this.threshold;
    const explicitReview = probability(result.answers.human_review_recommended) >= 0.5;
    const duplicate = result.answers.duplicate_candidate?.type === "choice" && result.answers.duplicate_candidate.choice !== "none";
    return {
      ...result,
      recommendation: explicitReview || duplicate ? "needs_human_review" : supported && publishable ? "ready_for_human_approval" : "needs_revision",
      requiresHumanApproval: true,
    };
  }
}
