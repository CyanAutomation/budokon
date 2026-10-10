import type { Technique } from "../domain/types.js";
import type { JevAnswer, JevDecisionResult, JevQuestion } from "./types.js";
import { createEditorialReviewQuestions, editorialReviewRecommendation, validateEditorialReviewInput } from "./editorial-review-policy.js";
import {
  MAX_EDITORIAL_REVIEW_BATCH_SIZE,
  type EditorialReviewBatchResult,
  type EditorialReviewInput,
} from "./editorial-review-contracts.js";

interface EditorialReviewRequest {
  state: unknown;
  questions: Record<string, JevQuestion>;
  questionIds: string[][];
}

function prepareProposals(inputs: EditorialReviewInput[]) {
  return inputs.map(input => {
    const candidates = input.duplicateCandidates ?? [];
    const techniqueById = new Map((input.techniques ?? []).map(technique => [technique.id, technique]));
    const resolvedTechniques = input.record.signatureMoveIds
      .map(id => techniqueById.get(id))
      .filter((value): value is Technique => value !== undefined);
    return { record: input.record, evidence: input.evidence, duplicateCandidates: candidates, resolvedTechniques };
  });
}

function prepareQuestions(inputs: EditorialReviewInput[]): Pick<EditorialReviewRequest, "questions" | "questionIds"> {
  const questions: Record<string, JevQuestion> = {};
  const questionIds: string[][] = [];
  for (const [index, input] of inputs.entries()) {
    const prefix = inputs.length === 1 ? "" : `proposal_${index}__`;
    const statePath = inputs.length === 1 ? "proposal" : `proposals[${index}]`;
    const proposalQuestions = createEditorialReviewQuestions(input, statePath);
    questionIds.push(Object.keys(proposalQuestions));
    for (const [id, question] of Object.entries(proposalQuestions)) questions[`${prefix}${id}`] = question;
  }
  return { questions, questionIds };
}

export function prepareEditorialReviewRequest(inputs: EditorialReviewInput[]): EditorialReviewRequest {
  if (!Array.isArray(inputs) || inputs.length === 0 || inputs.length > MAX_EDITORIAL_REVIEW_BATCH_SIZE) {
    throw new RangeError("reviewMany accepts between 1 and 10 proposals");
  }
  inputs.forEach(validateEditorialReviewInput);
  let serializedInputs: string;
  try { serializedInputs = JSON.stringify(inputs); }
  catch { throw new TypeError("review inputs must be JSON-serializable"); }
  if (new TextEncoder().encode(serializedInputs).byteLength > 64_000) {
    throw new RangeError("review batch exceeds the 64 KB JEV request limit");
  }

  const proposals = prepareProposals(inputs);
  const { questions, questionIds } = prepareQuestions(inputs);
  return { state: inputs.length === 1 ? proposals[0] : { proposals }, questions, questionIds };
}

function answersForProposal(result: JevDecisionResult, questionIds: string[], prefix: string): Record<string, JevAnswer> {
  return Object.fromEntries(questionIds.map(id => [id, result.answers[`${prefix}${id}`]])) as Record<string, JevAnswer>;
}

export function assembleEditorialReviewBatch(
  inputs: EditorialReviewInput[],
  questionIds: string[][],
  result: JevDecisionResult,
  threshold: number,
): EditorialReviewBatchResult {
  const reviews = inputs.map((input, index) => {
    const prefix = inputs.length === 1 ? "" : `proposal_${index}__`;
    const answers = answersForProposal(result, questionIds[index] ?? [], prefix);
    return {
      answers,
      recommendation: editorialReviewRecommendation(input, answers, threshold),
      requiresHumanApproval: true as const,
    };
  });
  return { model: result.model, usage: result.usage, reviews };
}
