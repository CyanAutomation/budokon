import type { CompiledDataset, JsonValue } from "../domain/types.js";

const byId = (left: { id: string }, right: { id: string }) =>
  left.id < right.id ? -1 : left.id > right.id ? 1 : 0;

const LEGACY_EVENTLESS_DATASET_VERSIONS = /^2026\.08\.[1-6]$/;

function validateCompiledDataset(model: CompiledDataset): void {
  const validCore = typeof model.datasetVersion === "string"
    && model.datasetVersion.trim() !== ""
    && Array.isArray(model.judoka)
    && Array.isArray(model.techniques)
    && model.countries !== null
    && typeof model.countries === "object"
    && !Array.isArray(model.countries)
    && Array.isArray(model.weightCategories);
  if (!validCore) throw new TypeError("invalid compiled dataset");

  const requiredMetadata: Array<[string, unknown]> = [
    ["manifest.serviceVersion", model.manifest?.serviceVersion],
    ["manifest.sourceGitCommit", model.manifest?.sourceGitCommit],
    ['manifest.checksums["budokon.json"]', model.manifest?.checksums?.["budokon.json"]],
  ];
  for (const [field, value] of requiredMetadata) {
    if (typeof value !== "string" || value.length === 0) {
      throw new TypeError(`invalid compiled dataset: ${field}`);
    }
  }
}

function parseDataset(value: CompiledDataset | JsonValue | string): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new TypeError(
      `Failed to parse JSON: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

/** Parse, validate, and sort a compiled JSON model before it enters the repository. */
export function readCompiledDataset(value: CompiledDataset | JsonValue | string): CompiledDataset {
  const parsed = parseDataset(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError("compiled dataset must be an object");
  }

  const model = parsed as CompiledDataset;
  validateCompiledDataset(model);
  if (!Array.isArray(model.events) && !LEGACY_EVENTLESS_DATASET_VERSIONS.test(model.datasetVersion)) {
    throw new TypeError("invalid compiled dataset: events");
  }

  return {
    ...model,
    judoka: [...model.judoka].sort(byId),
    techniques: [...model.techniques].sort(byId),
    events: [...(model.events ?? [])].sort(byId),
  };
}
