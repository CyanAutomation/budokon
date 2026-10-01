import type { Judoka, Technique } from "../domain/types.js";
import type { JevAnswer } from "./types.js";

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

export const MAX_EDITORIAL_REVIEW_BATCH_SIZE = 10;
