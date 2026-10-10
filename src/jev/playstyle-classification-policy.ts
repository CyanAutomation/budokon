import { PLAYSTYLE_OPTIONS, type PlaystyleFacet, type PlaystyleOption } from "../domain/playstyle.js";
import type { JevAnswer, JevQuestion } from "./types.js";
import {
  PLAYSTYLE_QUESTION_IDS,
  type PlaystyleFacetProposal,
  type PlaystyleClassification,
} from "./playstyle-classification-contracts.js";

const QUESTION_CRITERIA: Record<PlaystyleFacet, Record<string, string>> = {
  tacticalStyle: {
    pressure: "Choose pressure only when supplied match descriptions or source excerpts show the judoka repeatedly initiating attacks or combinations to force the opponent to defend. Titles, a high technique rating, or signature moves alone do not establish this.",
    counter: "Choose counter only when supplied descriptions show the judoka commonly waits for, redirects, or scores from the opponent's attacks or mistakes. A single counter example is insufficient to establish a pattern.",
    balanced: "Choose balanced when supplied evidence gives specific, comparable examples of both initiating attacks and countering, or explicitly describes a reliable mix with no dominant approach.",
    insufficient_evidence: "Choose insufficient_evidence when supplied excerpts do not describe repeatable attack-versus-counter patterns, when evidence is only biographical, or when sources conflict without enough detail to resolve the pattern.",
  },
  tempo: {
    patient: "Choose patient when supplied competition evidence describes deliberate pacing, selective attacks, grip establishment, or waiting for a clear opening across multiple situations.",
    balanced: "Choose balanced when supplied evidence shows the judoka deliberately varies pace between patient setup and sustained attacking, without either tempo clearly dominating.",
    aggressive: "Choose aggressive when supplied competition evidence describes sustained high attack frequency, rapid combinations, or consistently forcing exchanges. A high speed rating alone is not evidence of competitive tempo.",
    insufficient_evidence: "Choose insufficient_evidence when the supplied material does not describe competitive pacing or attack frequency, or when the evidence is too sparse or conflicting to distinguish the choices.",
  },
  gripStyle: {
    dominant: "Choose dominant when supplied evidence repeatedly shows the judoka securing and imposing a preferred grip or grip sequence before attacking.",
    adaptive: "Choose adaptive when supplied evidence gives examples of the judoka changing grip choices in response to different opponents or openings, rather than relying on one repeated approach.",
    defensive: "Choose defensive when supplied evidence repeatedly emphasizes breaking, denying, or avoiding the opponent's grips as the primary grip-fighting behaviour.",
    mixed: "Choose mixed when supplied evidence shows meaningful, repeated use of at least two distinct grip approaches and does not support one as dominant.",
    insufficient_evidence: "Choose insufficient_evidence when the supplied excerpts do not describe grip exchanges or the judoka's grip choices. A kumikata game rating alone is not sufficient.",
  },
  newazaEmphasis: {
    low: "Choose low only when supplied competition evidence explicitly shows that groundwork is rarely pursued or is a minor part of the judoka's match approach.",
    medium: "Choose medium when supplied evidence shows groundwork is a regular supporting part of the judoka's competition, but not a central scoring route or defining threat.",
    high: "Choose high when supplied evidence repeatedly identifies groundwork as a central scoring route, with frequent effective transitions, pins, submissions, or groundwork victories.",
    insufficient_evidence: "Choose insufficient_evidence when the excerpts do not describe groundwork use or frequency. A newaza game rating or a signature technique list alone does not establish competitive emphasis.",
  },
  standingPreference: {
    ashi_waza: "Choose ashi_waza only when supplied evidence supports a recurring standing preference for techniques whose resolved canonical subCategory is Ashi-waza.",
    te_waza: "Choose te_waza only when supplied evidence supports a recurring standing preference for techniques whose resolved canonical subCategory is Te-waza.",
    koshi_waza: "Choose koshi_waza only when supplied evidence supports a recurring standing preference for techniques whose resolved canonical subCategory is Koshi-waza.",
    ma_sutemi_waza: "Choose ma_sutemi_waza only when supplied evidence supports a recurring standing preference for techniques whose resolved canonical subCategory is Ma-sutemi-waza.",
    yoko_sutemi_waza: "Choose yoko_sutemi_waza only when supplied evidence supports a recurring standing preference for techniques whose resolved canonical subCategory is Yoko-sutemi-waza.",
    mixed: "Choose mixed when supplied evidence supports meaningful use of at least two standing technique subcategories from the resolved canonical Nage-waza taxonomy, without one clearly preferred category.",
    insufficient_evidence: "Choose insufficient_evidence when the evidence does not establish which resolved standing technique categories are repeatedly preferred. Signature moves are supporting context, not proof of a competitive preference.",
  },
};

export function validatePlaystyleConfidenceThreshold(threshold: number): void {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new RangeError("playstyle confidence threshold must be between 0 and 1");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function createPlaystyleClassificationQuestions(statePath = "state"): Record<string, JevQuestion> {
  return Object.fromEntries((Object.keys(PLAYSTYLE_OPTIONS) as PlaystyleFacet[]).map(facet => {
    const questionId = PLAYSTYLE_QUESTION_IDS[facet];
    return [questionId, {
      type: "choice" as const,
      instructions: `Classify only the ${facet} facet for \`${statePath}.judoka\`. Use the supplied \`${statePath}.evidence\`, biography, and resolved technique metadata as bounded context. Read each option's criteria as its definition. The editorialRatings are game ratings, not objective competition facts. Ignore unrelated biographical details. Choose insufficient_evidence when specific repeated competitive evidence is absent or materially conflicting.`,
      criteria: Object.fromEntries(PLAYSTYLE_OPTIONS[facet].map(option => [option, QUESTION_CRITERIA[facet][option]])),
    }];
  }));
}

function validProbability(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function validateChoiceAnswer(answer: unknown, facet: PlaystyleFacet): PlaystyleFacetProposal {
  if (!isRecord(answer) || answer.type !== "choice" || typeof answer.choice !== "string") {
    throw new TypeError(`JEV playstyle answer for ${facet} must be a choice`);
  }
  const allowed = PLAYSTYLE_OPTIONS[facet] as readonly string[];
  if (!allowed.includes(answer.choice)) throw new TypeError(`JEV playstyle answer for ${facet} is outside the allowed choices`);
  if (!validProbability(answer.confidence)) throw new TypeError(`JEV playstyle confidence for ${facet} must be between 0 and 1`);
  if (!isRecord(answer.probabilities)) throw new TypeError(`JEV playstyle probabilities for ${facet} are malformed`);
  const probabilityKeys = Object.keys(answer.probabilities);
  if (probabilityKeys.length !== allowed.length || !allowed.every(option => Object.hasOwn(answer.probabilities as object, option))
    || !Object.values(answer.probabilities).every(validProbability)) {
    throw new TypeError(`JEV playstyle probabilities for ${facet} do not match the allowed choices`);
  }
  const probabilities = answer.probabilities as Record<string, number>;
  const probabilityTotal = Object.values(probabilities).reduce((total, probability) => total + probability, 0);
  if (Math.abs(probabilityTotal - 1) > 0.01) throw new TypeError(`JEV playstyle probabilities for ${facet} must sum to 1`);
  const proposed = answer.choice as PlaystyleOption<typeof facet>;
  return { proposed, confidence: answer.confidence, policyAccepted: null } as PlaystyleFacetProposal;
}

export function validatePlaystyleDecisionResult(
  value: unknown,
  questions: Record<string, JevQuestion>,
): { model: string; usage: Record<string, unknown>; answers: Record<string, JevAnswer> } {
  if (!isRecord(value) || typeof value.model !== "string" || value.model.trim() === ""
    || !isRecord(value.usage) || !isRecord(value.answers)) {
    throw new TypeError("JEV playstyle response is malformed");
  }
  const answerKeys = Object.keys(value.answers);
  const questionKeys = Object.keys(questions);
  if (answerKeys.length !== questionKeys.length || !questionKeys.every(key => Object.hasOwn(value.answers as object, key))) {
    throw new TypeError("JEV playstyle response is missing or contains unexpected answers");
  }
  const answers = value.answers as Record<string, JevAnswer>;
  for (const facet of Object.keys(PLAYSTYLE_OPTIONS) as PlaystyleFacet[]) {
    const questionId = PLAYSTYLE_QUESTION_IDS[facet];
    validateChoiceAnswer(answers[questionId], facet);
  }
  return { model: value.model, usage: value.usage, answers };
}

export function classifyPlaystyleAnswers(
  answers: Record<string, JevAnswer>,
  threshold: number,
): PlaystyleClassification {
  validatePlaystyleConfidenceThreshold(threshold);
  const classification = {} as Record<PlaystyleFacet, PlaystyleFacetProposal>;
  for (const facet of Object.keys(PLAYSTYLE_OPTIONS) as PlaystyleFacet[]) {
    const answer = answers[PLAYSTYLE_QUESTION_IDS[facet]];
    const proposal = validateChoiceAnswer(answer, facet);
    classification[facet] = {
      ...proposal,
      policyAccepted: proposal.proposed !== "insufficient_evidence" && proposal.confidence >= threshold
        ? proposal.proposed as PlaystyleFacetProposal["policyAccepted"]
        : null,
    };
  }
  return classification as unknown as PlaystyleClassification;
}
