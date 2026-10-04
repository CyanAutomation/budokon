import type { Technique } from "../domain/types.js";
import { PLAYSTYLE_OPTIONS, type PlaystyleFacet, type PlaystyleOption } from "../domain/playstyle.js";
import type { JevAnswer, JevQuestion } from "./types.js";
import {
  MAX_PLAYSTYLE_EVIDENCE_ITEMS,
  MAX_PLAYSTYLE_REQUEST_BYTES,
  PLAYSTYLE_QUESTION_IDS,
  type PlaystyleClassificationInput,
  type PlaystyleEvidence,
  type PlaystyleFacetProposal,
  type PlaystyleClassification,
  type PlaystyleJudokaRecord,
} from "./playstyle-classification-contracts.js";

type PlaystyleState = {
  judoka: {
    id: string;
    slug: string;
    name?: string;
    biography: string;
    signatureMoveIds: string[];
    editorialRatings?: { technique?: number; kumikata?: number; newaza?: number };
  };
  resolvedTechniques: Array<{
    id: string;
    name: string;
    japanese: string;
    category: string;
    subCategory: string;
    description: string;
  }>;
  evidence: PlaystyleEvidence[];
};

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

function validateEvidence(value: unknown): PlaystyleEvidence[] {
  if (!Array.isArray(value) || value.length > MAX_PLAYSTYLE_EVIDENCE_ITEMS) {
    throw new RangeError(`evidence must contain at most ${MAX_PLAYSTYLE_EVIDENCE_ITEMS} source excerpts`);
  }
  return value.map((item, index) => {
    if (!isRecord(item) || typeof item.url !== "string" || typeof item.excerpt !== "string"
      || item.excerpt.trim().length === 0 || item.excerpt.length > 4_000) {
      throw new TypeError(`evidence[${index}] must include an HTTPS URL and a 1–4000 character excerpt`);
    }
    try {
      if (new URL(item.url).protocol !== "https:") throw new Error();
    } catch {
      throw new TypeError(`evidence[${index}].url must be an HTTPS URL`);
    }
    return { url: item.url, excerpt: item.excerpt };
  });
}

function validateEditorialRatings(record: PlaystyleJudokaRecord): PlaystyleState["judoka"]["editorialRatings"] {
  const rawStats: unknown = record.stats;
  if (rawStats === undefined) return undefined;
  if (!isRecord(rawStats)) throw new TypeError("record.stats must be an object when supplied");
  const ratings: NonNullable<PlaystyleState["judoka"]["editorialRatings"]> = {};
  for (const key of ["technique", "kumikata", "newaza"] as const) {
    const rating = rawStats[key];
    if (rating === undefined) continue;
    if (typeof rating !== "number" || !Number.isInteger(rating) || rating < 0 || rating > 10) {
      throw new TypeError(`record.stats.${key} must be an integer between 0 and 10`);
    }
    ratings[key] = rating;
  }
  return Object.keys(ratings).length ? ratings : undefined;
}

function projectTechnique(value: Technique, index: number): PlaystyleState["resolvedTechniques"][number] {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id
    || typeof value.name !== "string" || !value.name.trim() || value.name.length > 200
    || typeof value.japanese !== "string" || !value.japanese.trim() || value.japanese.length > 200
    || typeof value.category !== "string" || value.category.length > 100
    || typeof value.subCategory !== "string" || value.subCategory.length > 100
    || typeof value.description !== "string" || value.description.length > 2_000) {
    throw new TypeError(`techniques[${index}] is not a bounded resolved technique record`);
  }
  return {
    id: value.id,
    name: value.name,
    japanese: value.japanese,
    category: value.category,
    subCategory: value.subCategory,
    description: value.description,
  };
}

export function buildPlaystyleState(input: PlaystyleClassificationInput): PlaystyleState {
  if (!isRecord(input) || !isRecord(input.record)) throw new TypeError("record must be an object");
  const record = input.record;
  if (typeof record.id !== "string" || !record.id || typeof record.slug !== "string" || !record.slug) {
    throw new TypeError("record must include a non-empty id and slug");
  }
  const raw = record as unknown as Record<string, unknown>;
  if (typeof raw.bio !== "string" || raw.bio.trim().length === 0 || raw.bio.length > 8_000) {
    throw new TypeError("record.bio must be a non-empty string of at most 8000 characters");
  }
  if (!Array.isArray(record.signatureMoveIds) || record.signatureMoveIds.length > 20
    || !record.signatureMoveIds.every(id => typeof id === "string" && id.length > 0)
    || new Set(record.signatureMoveIds).size !== record.signatureMoveIds.length) {
    throw new TypeError("record.signatureMoveIds must contain at most 20 unique non-empty IDs");
  }
  if (!Array.isArray(input.techniques) || input.techniques.length !== record.signatureMoveIds.length) {
    throw new TypeError("techniques must resolve every signatureMoveId exactly once");
  }
  const resolvedById = new Map<string, PlaystyleState["resolvedTechniques"][number]>();
  input.techniques.forEach((technique, index) => {
    const projected = projectTechnique(technique, index);
    if (resolvedById.has(projected.id)) throw new TypeError(`duplicate resolved technique ${projected.id}`);
    resolvedById.set(projected.id, projected);
  });
  const resolvedTechniques = record.signatureMoveIds.map(id => {
    const technique = resolvedById.get(id);
    if (!technique) throw new TypeError(`signatureMoveId ${id} has no resolved technique`);
    return technique;
  });
  const evidence = validateEvidence(input.evidence);
  const firstname = typeof record.firstname === "string" ? record.firstname : undefined;
  const surname = typeof record.surname === "string" ? record.surname : undefined;
  const name = [firstname, surname].filter(Boolean).join(" ") || undefined;
  const editorialRatings = validateEditorialRatings(record);
  const state: PlaystyleState = {
    judoka: {
      id: record.id,
      slug: record.slug,
      ...(name ? { name } : {}),
      biography: raw.bio,
      signatureMoveIds: [...record.signatureMoveIds],
      ...(editorialRatings ? { editorialRatings } : {}),
    },
    resolvedTechniques,
    evidence,
  };
  let bytes: number;
  try { bytes = new TextEncoder().encode(JSON.stringify(state)).byteLength; }
  catch { throw new TypeError("playstyle state must be JSON-serializable"); }
  if (bytes > MAX_PLAYSTYLE_REQUEST_BYTES) throw new RangeError("playstyle state exceeds the 64 KB JEV request limit");
  return state;
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
