import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { ReadModelRepository } from "./read-model-repository.mjs";

const byId = (a, b) => a.id.localeCompare(b.id);
export class JsonReadModelRepository extends ReadModelRepository {
  constructor(model, datasetVersion) { super(); this.model = model; this._datasetVersion = datasetVersion; }
  static async load({ judokaUrl = new URL("../../dist/judoka.json", import.meta.url), techniquesUrl = new URL("../../dist/techniques.json", import.meta.url), countriesUrl = new URL("../../data/reference/countries.json", import.meta.url), weightsUrl = new URL("../../data/reference/weight-categories.json", import.meta.url) } = {}) {
    try {
      const bytes = await Promise.all([judokaUrl, techniquesUrl, countriesUrl, weightsUrl].map(url => readFile(url)));
      const [judoka, techniques, countries, weightCategories] = bytes.map(value => JSON.parse(value));
      const version = createHash("sha256").update(bytes.map(value => value.toString("utf8")).join("\0")).digest("hex");
      return new this({ judoka: [...judoka].sort(byId), techniques: [...techniques].sort(byId), countries, weightCategories }, version);
    } catch (error) {
      throw new Error(`Failed to load read model: ${error.message}`, { cause: error });
    }
  }
  }
  get datasetVersion() { return this._datasetVersion; }
  listJudoka() { return this.model.judoka.slice(); }
  getJudoka(key) { return this.model.judoka.find(j => j.id === key || j.slug === key || j.aliases?.includes(key)); }
  listTechniques() { return this.model.techniques.slice(); }
  getTechnique(id) { return this.model.techniques.find(t => t.id === id); }
  listCountries() { return structuredClone(this.model.countries); }
  listWeightCategories() { return structuredClone(this.model.weightCategories); }
}
