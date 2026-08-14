const FILTER_FIELDS = new Set(["countryCode", "gender", "weightClass", "rarity", "personType", "signatureMoveId"]);

export function normalizeFilters(filters = {}) {
  if (filters === null || typeof filters !== "object" || Array.isArray(filters)) throw new TypeError("filters must be an object");
  return Object.fromEntries(Object.entries(filters).sort(([a], [b]) => a.localeCompare(b)).map(([field, value]) => {
    if (!FILTER_FIELDS.has(field)) throw new TypeError(`unsupported filter: ${field}`);
    const values = (Array.isArray(value) ? value : [value]).map(String).map(v => v.trim()).filter(Boolean);
    if (!values.length) throw new TypeError(`filter ${field} must not be empty`);
    return [field, [...new Set(values)].sort()];
  }));
}

export class CatalogService {
  constructor(repository) { this.repository = repository; }
  version() { return { datasetVersion: this.repository.datasetVersion, serviceVersion: this.repository.serviceVersion }; }
  listJudoka(options = {}) {
    const filters = normalizeFilters(options.filters);
    const exclusions = new Set((options.exclude ?? []).map(String));
    const includeHidden = options.includeHidden === true && options.authorizedInternal === true;
    return this.repository.listJudoka().filter(j => includeHidden || j.isHidden !== true).filter(j =>
      Object.entries(filters).every(([field, values]) => j[field] != null && values.includes(String(j[field])))
    ).filter(j => !exclusions.has(j.id) && !exclusions.has(j.slug));
  }
  getJudoka(id, options = {}) {
    const match = this.repository.getJudoka(id);
    return match && (match.isHidden !== true || (options.includeHidden === true && options.authorizedInternal === true)) ? match : undefined;
  }
  listTechniques() { return this.repository.listTechniques(); }
  getTechnique(id) { return this.repository.getTechnique(id); }
  listCountries() { return this.repository.listCountries(); }
  listWeightCategories() { return this.repository.listWeightCategories(); }
}
