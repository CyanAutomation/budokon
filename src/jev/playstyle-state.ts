import type { Technique } from "../domain/types.js";
import {
  MAX_PLAYSTYLE_EVIDENCE_ITEMS,
  MAX_PLAYSTYLE_REQUEST_BYTES,
  type PlaystyleClassificationInput,
  type PlaystyleEvidence,
  type PlaystyleJudokaRecord,
} from "./playstyle-classification-contracts.js";

interface PlaystyleState {
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
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateRecord(input: PlaystyleClassificationInput): { record: PlaystyleJudokaRecord; biography: string } {
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
  return { record, biography: raw.bio };
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

function resolveTechniques(signatureMoveIds: string[], techniques: Technique[]): PlaystyleState["resolvedTechniques"] {
  if (!Array.isArray(techniques) || techniques.length !== signatureMoveIds.length) {
    throw new TypeError("techniques must resolve every signatureMoveId exactly once");
  }
  const resolvedById = new Map<string, PlaystyleState["resolvedTechniques"][number]>();
  techniques.forEach((technique, index) => {
    const projected = projectTechnique(technique, index);
    if (resolvedById.has(projected.id)) throw new TypeError(`duplicate resolved technique ${projected.id}`);
    resolvedById.set(projected.id, projected);
  });
  return signatureMoveIds.map(id => {
    const technique = resolvedById.get(id);
    if (!technique) throw new TypeError(`signatureMoveId ${id} has no resolved technique`);
    return technique;
  });
}

function projectJudoka(record: PlaystyleJudokaRecord, biography: string): PlaystyleState["judoka"] {
  const firstname = typeof record.firstname === "string" ? record.firstname : undefined;
  const surname = typeof record.surname === "string" ? record.surname : undefined;
  const name = [firstname, surname].filter(Boolean).join(" ") || undefined;
  const editorialRatings = validateEditorialRatings(record);
  return {
    id: record.id,
    slug: record.slug,
    ...(name ? { name } : {}),
    biography,
    signatureMoveIds: [...record.signatureMoveIds],
    ...(editorialRatings ? { editorialRatings } : {}),
  };
}

function enforceRequestSize(state: PlaystyleState): void {
  let bytes: number;
  try { bytes = new TextEncoder().encode(JSON.stringify(state)).byteLength; }
  catch { throw new TypeError("playstyle state must be JSON-serializable"); }
  if (bytes > MAX_PLAYSTYLE_REQUEST_BYTES) throw new RangeError("playstyle state exceeds the 64 KB JEV request limit");
}

export function buildPlaystyleState(input: PlaystyleClassificationInput): PlaystyleState {
  const { record, biography } = validateRecord(input);
  const state: PlaystyleState = {
    judoka: projectJudoka(record, biography),
    resolvedTechniques: resolveTechniques(record.signatureMoveIds, input.techniques),
    evidence: validateEvidence(input.evidence),
  };
  enforceRequestSize(state);
  return state;
}
