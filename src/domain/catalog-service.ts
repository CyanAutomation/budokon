import type { Filters, Judoka, ListJudokaOptions, SearchJudokaOptions, VersionResponse } from "./types.js";
import type { ReadModelRepository } from "../repository/read-model-repository.js";

const FILTER_FIELDS = new Set(["countryCode", "gender", "weightClass", "rarity", "personType", "signatureMoveId"]);
const byImmutableId = (a: Judoka, b: Judoka) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

export function normalizeSearchText(value: unknown): string {
  return String(value ?? "").normalize("NFD").replace(/\p{Mark}+/gu, "").toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ").trim().replace(/\s+/gu, " ");
}
function searchableValues(judoka: Judoka) {
  return [judoka.slug, judoka.firstname, judoka.surname, `${judoka.firstname ?? ""} ${judoka.surname ?? ""}`.trim(), ...(judoka.aliases ?? [])].map(normalizeSearchText).filter(Boolean);
}
export function normalizeFilters(filters: Filters = {}): Record<string, string[]> {
  if (filters === null || typeof filters !== "object" || Array.isArray(filters)) throw new TypeError("filters must be an object");
  return Object.fromEntries(Object.entries(filters).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([field, value]) => {
    if (!FILTER_FIELDS.has(field)) throw new TypeError(`unsupported filter: ${field}`);
    const values = (Array.isArray(value) ? value : [value]).map(String).map(v => v.trim()).filter(Boolean);
    if (!values.length) throw new TypeError(`filter ${field} must not be empty`);
    return [field, [...new Set(values)].sort()];
  }));
}
export class CatalogService {
  constructor(readonly repository: ReadModelRepository) {}
  version(): VersionResponse { return { datasetVersion: this.repository.datasetVersion, serviceVersion: this.repository.serviceVersion }; }
  listJudoka(options: ListJudokaOptions = {}): Judoka[] {
    const filters = normalizeFilters(options.filters); const exclusions = new Set((options.exclude ?? []).map(String));
    const includeHidden = options.includeHidden === true && options.authorizedInternal === true;
    const collection = options.collection === undefined ? undefined : String(options.collection);
    const record = collection === undefined ? undefined : this.repository.getCollection(collection);
    const members = record ? new Set((record.members ?? []).map(String)) : undefined;
    return this.repository.listJudoka().filter(j => includeHidden || j.isHidden !== true)
      .filter(j => Object.entries(filters).every(([field, values]) => j[field] != null && values.includes(String(j[field]))))
      .filter(j => !exclusions.has(j.id) && !exclusions.has(j.slug))
      .filter(j => collection === undefined || (members ? members.has(j.id) || members.has(j.slug) : j.collections?.includes(collection)));
  }
  searchJudoka(options: SearchJudokaOptions = {}) { const query = normalizeSearchText(options.query ?? options.q); return (query ? this.listJudoka(options).filter(j => searchableValues(j).some(value => value.includes(query))) : this.listJudoka(options)).sort(query ? byImmutableId : () => 0); }
  getJudoka(id: string | undefined, options: Pick<ListJudokaOptions, "includeHidden" | "authorizedInternal"> = {}) { const match = this.repository.getJudoka(id); return match && (match.isHidden !== true || (options.includeHidden === true && options.authorizedInternal === true)) ? match : undefined; }
  listTechniques() { return this.repository.listTechniques(); } getTechnique(id: string | undefined) { return this.repository.getTechnique(id); }
  listCountries() { return this.repository.listCountries(); } listWeightCategories() { return this.repository.listWeightCategories(); }
}
