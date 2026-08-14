const ok = body => ({ status: 200, body });
const missing = () => ({ status: 404, body: { error: "not found" } });
const queryFilters = query => Object.fromEntries(["countryCode", "gender", "weightClass", "rarity", "personType", "signatureMoveId"].filter(k => query?.[k] !== undefined).map(k => [k, query[k]]));
export function createRestHandlers({ catalog, draw }) {
  return {
    listJudoka: ({ query = {}, authorizedInternal = false } = {}) => ok(catalog.listJudoka({ filters: queryFilters(query), includeHidden: query.includeHidden === true, authorizedInternal })),
    getJudoka: ({ params = {}, query = {}, authorizedInternal = false } = {}) => { const value = catalog.getJudoka(params?.id, { includeHidden: query?.includeHidden === true, authorizedInternal }); return value ? ok(value) : missing(); },
    listTechniques: () => ok(catalog.listTechniques()),
    getTechnique: ({ params = {} } = {}) => { const value = catalog.getTechnique(params?.id); return value ? ok(value) : missing(); },
    listCountries: () => ok(catalog.listCountries()), listWeightCategories: () => ok(catalog.listWeightCategories()),
    draw: ({ body, authorizedInternal = false }) => ok(draw.draw(body, { authorizedInternal })), version: () => ok(catalog.version())
  };
}
