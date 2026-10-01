import type { JevAnswer, JevDecisionResult, JevQuestion } from "./types.js";

const validProbability = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;

function validDistribution(value: unknown, expectedKeys: string[]): value is Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const distribution = value as Record<string, unknown>;
  const keys = Object.keys(distribution);
  if (keys.length !== expectedKeys.length || !expectedKeys.every(key => Object.hasOwn(distribution, key))) return false;
  if (!Object.values(distribution).every(validProbability)) return false;
  const total = Object.values(distribution as Record<string, number>).reduce((sum, probability) => sum + probability, 0);
  return Math.abs(total - 1) <= 0.01;
}

function validChoiceAnswer(question: Extract<JevQuestion, { type: "choice" }>, value: Record<string, unknown>): boolean {
  if (value.type !== "choice" || typeof value.choice !== "string" || !Object.hasOwn(question.criteria, value.choice)) return false;
  const options = Object.keys(question.criteria);
  return validDistribution(value.probabilities, options)
    && Object.hasOwn(value.probabilities as object, value.choice)
    && validProbability(value.confidence);
}

function validScoreAnswer(question: Extract<JevQuestion, { type: "score" }>, value: Record<string, unknown>): boolean {
  if (value.type !== "score" || typeof value.score !== "number" || !Number.isFinite(value.score)) return false;
  if (value.score < 0 || value.score > question.criteria.length - 1) return false;
  const levels = question.criteria.map((_, index) => String(index));
  if (!validDistribution(value.probabilities, levels) || !validProbability(value.confidence)) return false;
  if (!value.legend || typeof value.legend !== "object" || Array.isArray(value.legend)) return false;
  const legend = value.legend as Record<string, unknown>;
  return Object.keys(legend).length === levels.length
    && levels.every(level => legend[level] === question.criteria[Number(level)]);
}

function validAnswer(question: JevQuestion, answer: unknown): answer is JevAnswer {
  if (!answer || typeof answer !== "object") return false;
  const value = answer as Record<string, unknown>;
  if (question.type === "noul") return value.type === "noul" && validProbability(value.noul);
  if (question.type === "choice") return validChoiceAnswer(question, value);
  return validScoreAnswer(question, value);
}

export function parseJevResponse(value: unknown, questions: Record<string, JevQuestion>): JevDecisionResult | undefined {
  if (!value || typeof value !== "object") return undefined;
  const body = value as { model?: unknown; answers?: unknown; usage?: unknown };
  if (typeof body.model !== "string" || !body.model.trim()
    || !body.usage || typeof body.usage !== "object" || Array.isArray(body.usage)
    || !body.answers || typeof body.answers !== "object" || Array.isArray(body.answers)) return undefined;
  const answers = body.answers as Record<string, unknown>;
  const ids = Object.keys(questions);
  if (Object.keys(answers).length !== ids.length || !ids.every(id => validAnswer(questions[id], answers[id]))) return undefined;
  return {
    model: body.model,
    answers: answers as Record<string, JevAnswer>,
    usage: body.usage as Record<string, unknown>,
  };
}
