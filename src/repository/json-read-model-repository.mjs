import { readFile } from "node:fs/promises";
import { ReadModelRepository } from "./read-model-repository.mjs";

const byId = (a, b) => a.id.localeCompare(b.id);
export class JsonReadModelRepository extends ReadModelRepository {
  constructor(model, release) { super(); this.model = model; this.release = release; }
  static async load({ judokaUrl = new URL("../../dist/judoka.json", import.meta.url), techniquesUrl = new URL("../../dist/techniques.json", import.meta.url), countriesUrl = new URL("../../data/reference/countries.json", import.meta.url), weightsUrl = new URL("../../data/reference/weight-categories.json", import.meta.url), manifestUrl = new URL("../../dist/manifest.json", import.meta.url) } = {}) {
    try {
      const values = await Promise.all([judokaUrl, techniquesUrl, countriesUrl, weightsUrl, manifestUrl].map(async url => JSON.parse(await readFile(url, 'utf8'))));
      const [judoka, techniques, countries, weightCategories, manifest] = values;
      return new this({ judoka: [...judoka].sort(byId), techniques: [...techniques].sort(byId), countries, weightCategories }, manifest);
    } catch (error) {
      throw new Error(`Failed to load read model: ${error.message}`, { cause: error });
    }
  }
  get datasetVersion() { return this.release.datasetVersion; }
  get serviceVersion() { return this.release.serviceVersion; }
  listJudoka() { return this.model.judoka.slice(); }
  getJudoka(key) { return this.model.judoka.find(j => j.id === key || j.slug === key || j.aliases?.includes(key)); }
  listTechniques() { return this.model.techniques.slice(); }
  getTechnique(id) { return this.model.techniques.find(t => t.id === id); }
  listCountries() { return structuredClone(this.model.countries); }
  listWeightCategories() { return structuredClone(this.model.weightCategories); }
}
