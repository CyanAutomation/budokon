import type { CompiledDataset, JsonValue } from "../domain/types.js";
import { readCompiledDataset } from "./compiled-dataset-reader.js";
import { findJudokaByKey } from "./judoka-key-lookup.js";
import { ReadModelRepository } from "./read-model-repository.js";

/** In-memory repository with no filesystem or runtime-specific dependencies. */
export class JsonReadModelRepository extends ReadModelRepository {
  readonly model: CompiledDataset;

  constructor(value: CompiledDataset | JsonValue | string) {
    super();
    this.model = readCompiledDataset(value);
  }

  get datasetVersion() {
    return this.model.datasetVersion;
  }

  get serviceVersion() {
    return this.model.manifest!.serviceVersion;
  }

  get sourceGitCommit() {
    return this.model.manifest!.sourceGitCommit;
  }

  get datasetChecksum() {
    return this.model.manifest!.checksums["budokon.json"];
  }

  listJudoka() {
    return this.model.judoka.slice();
  }

  getJudoka(key: string | undefined) {
    return findJudokaByKey(this.model.judoka, key);
  }

  listTechniques() {
    return this.model.techniques.slice();
  }

  getTechnique(id: string | undefined) {
    if (id === undefined) return undefined;
    return this.model.techniques.find(technique => technique.id === id);
  }

  listEvents() {
    if (!this.model.events) throw new Error("Events not available in dataset");
    return this.model.events.slice();
  }

  getEvent(id: string | undefined) {
    if (!this.model.events) throw new Error("Events not available in dataset");
    if (id === undefined) return undefined;
    return this.model.events.find(event => event.id === id);
  }

  listCountries() {
    return structuredClone(this.model.countries);
  }

  listWeightCategories() {
    return structuredClone(this.model.weightCategories);
  }
}
