import type { CompiledDataset, JsonValue } from "../domain/types.js";
import { ReadModelRepository } from "./read-model-repository.js";

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
    if (!Array.isArray(model.judoka) || !Array.isArray(model.techniques) || !model.countries || !Array.isArray(model.weightCategories) || !model.manifest) {
      throw new TypeError("invalid compiled dataset");
    }
    this.model = { ...model, judoka: [...model.judoka].sort(byId), techniques: [...model.techniques].sort(byId) };
  }
  get datasetVersion() { if (!this.model.manifest.datasetVersion) throw new Error("Invalid manifest: missing datasetVersion"); return this.model.manifest.datasetVersion; }
  get serviceVersion() { if (!this.model.manifest.serviceVersion) throw new Error("Invalid manifest: missing serviceVersion"); return this.model.manifest.serviceVersion; }
  listJudoka() { return this.model.judoka.slice(); }
  getJudoka(key: string | undefined) { return key === undefined ? undefined : this.model.judoka.find(j => j.id === key || j.slug === key || j.aliases?.includes(key)); }
  getCollection(key: string) { return this.model.collections?.find(collection => collection.id === key); }
  listTechniques() { return this.model.techniques.slice(); }
  getTechnique(id: string | undefined) { return id === undefined ? undefined : this.model.techniques.find(t => t.id === id); }
  listCountries() { return structuredClone(this.model.countries); }
  listWeightCategories() { return structuredClone(this.model.weightCategories); }
}
