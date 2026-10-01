import type { Technique } from "../domain/types.js";
import type { JevAnswer, JevDecisionClient, JevQuestion } from "./types.js";
import {
  createEditorialReviewQuestions,
  editorialReviewRecommendation,
  validateEditorialReviewInput,
} from "./editorial-review-policy.js";
import {
  MAX_EDITORIAL_REVIEW_BATCH_SIZE,
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
    if (!Array.isArray(inputs) || inputs.length === 0 || inputs.length > MAX_EDITORIAL_REVIEW_BATCH_SIZE) {
      throw new RangeError("reviewMany accepts between 1 and 10 proposals");
    }
    inputs.forEach(validateEditorialReviewInput);
    let serializedInputs: string;
    try { serializedInputs = JSON.stringify(inputs); }
    catch { throw new TypeError("review inputs must be JSON-serializable"); }
    if (new TextEncoder().encode(serializedInputs).byteLength > 64_000) throw new RangeError("review batch exceeds the 64 KB JEV request limit");

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
      const proposalQuestions = createEditorialReviewQuestions(input, statePath);
      questionIds.push(Object.keys(proposalQuestions));
      for (const [id, question] of Object.entries(proposalQuestions)) questions[`${prefix}${id}`] = question;
    }
    const result = await this.client.decide(inputs.length === 1 ? proposals[0] : { proposals }, questions);
    const reviews = inputs.map((input, index) => {
      const prefix = inputs.length === 1 ? "" : `proposal_${index}__`;
      const answers = Object.fromEntries(questionIds[index].map(id => [id, result.answers[`${prefix}${id}`]])) as Record<string, JevAnswer>;
      return {
        answers,
        recommendation: editorialReviewRecommendation(input, answers, this.threshold),
        requiresHumanApproval: true as const,
      };
    });
    return { model: result.model, usage: result.usage, reviews };
  }
}
