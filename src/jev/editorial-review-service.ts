import type { JevDecisionClient } from "./types.js";
import { assembleEditorialReviewBatch, prepareEditorialReviewRequest } from "./editorial-review-batch.js";
import {
  type EditorialReviewBatchResult,
  type EditorialReviewInput,
  type EditorialReviewResult,
  type EditorialReviewer,
} from "./editorial-review-contracts.js";

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
    const request = prepareEditorialReviewRequest(inputs);
    const result = await this.client.decide(request.state, request.questions);
    return assembleEditorialReviewBatch(inputs, request.questionIds, result, this.threshold);
  }
}
