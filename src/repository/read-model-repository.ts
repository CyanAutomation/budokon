import type { Collection, Country, Judoka, Technique, WeightCategoryGroup } from "../domain/types.js";

/** Runtime-neutral interface for application access to an immutable read model. */
export abstract class ReadModelRepository {
  abstract get datasetVersion(): string;
  abstract get serviceVersion(): string;
  abstract listJudoka(): Judoka[];
  abstract getJudoka(id: string | undefined): Judoka | undefined;
  listCollections(): Collection[] { return []; }
  getCollection(_id: string | undefined): Collection | undefined { return undefined; }
  abstract listTechniques(): Technique[];
  abstract getTechnique(id: string | undefined): Technique | undefined;
  abstract listCountries(): Record<string, Country>;
  abstract listWeightCategories(): WeightCategoryGroup[];
}
