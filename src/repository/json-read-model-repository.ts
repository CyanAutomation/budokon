import type { CompiledDataset, JsonValue } from "../domain/types.js";
import { ReadModelRepository } from "./read-model-repository.js";
import { normalizeSearchText } from "../domain/catalog-filters.js";

const byId = (a: { id: string }, b: { id: string }) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/** In-memory repository with no filesystem or runtime-specific dependencies. */
export class JsonReadModelRepository extends ReadModelRepository {
  readonly model: CompiledDataset;

  constructor(value: CompiledDataset | JsonValue | string) {
    super();
    const parsed: unknown = typeof value === "string" ? (() => {
      try {
        return JSON.parse(value);
      } catch (error) {
        throw new TypeError(`Failed to parse JSON: ${error instanceof Error ? error.message : String(error)}`);
      }
    })() : value;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new TypeError("compiled dataset must be an object");
    const model = parsed as CompiledDataset;
    if (typeof model.datasetVersion !== "string" || model.datasetVersion.trim() === "" || !Array.isArray(model.judoka) || !Array.isArray(model.techniques) || !model.countries || !Array.isArray(model.weightCategories)) {
      throw new TypeError("invalid compiled dataset");
    }
    this.model = { ...model, judoka: [...model.judoka].sort(byId), techniques: [...model.techniques].sort(byId), events: [...(model.events ?? [])].sort(byId) };
  }
  get datasetVersion() { return this.model.datasetVersion; }
  get serviceVersion() { if (!this.model.manifest?.serviceVersion) throw new Error("Invalid manifest: missing serviceVersion"); return this.model.manifest.serviceVersion; }
  get sourceGitCommit() { if (!this.model.manifest?.sourceGitCommit) throw new Error("Invalid manifest: missing sourceGitCommit"); return this.model.manifest.sourceGitCommit; }
  get datasetChecksum() {
    const value = this.model.manifest?.checksums?.["budokon.json"];
    if (!value) throw new Error("Invalid manifest: missing budokon.json checksum");
    return value;
  }
  listJudoka() { return this.model.judoka.slice(); }
  getJudoka(key: string | undefined) {
    if (key === undefined) return undefined;
    const normalized = normalizeSearchText(key);
    return this.model.judoka.find(j => j.id === key || j.slug === key || j.legacySlugs?.includes(key)
      || [j.firstname, j.surname, `${j.firstname ?? ""} ${j.surname ?? ""}`.trim(), ...(j.aliases ?? [])]
        .some(value => normalizeSearchText(value) === normalized));
  }
  listTechniques() { return this.model.techniques.slice(); }
  getTechnique(id: string | undefined) { return id === undefined ? undefined : this.model.techniques.find(t => t.id === id); }
  listEvents() { if (!this.model.events) throw new Error("Events not available in dataset"); return this.model.events.slice(); }
  getEvent(id: string | undefined) { if (!this.model.events) throw new Error("Events not available in dataset"); return id === undefined ? undefined : this.model.events.find(event => event.id === id); }
  listCountries() { return structuredClone(this.model.countries); }
  listWeightCategories() { return structuredClone(this.model.weightCategories); }
}
