import type { CatalogService } from "../domain/catalog-service.js";
import type { DrawRequest, JsonValue } from "../domain/types.js";
import type { DrawService } from "../draw/draw-service.js";
export interface ApiRequest { query?: Record<string, unknown> | null; params?: Record<string, string | undefined> | null; body?: DrawRequest; authorizedInternal?: boolean; }
export interface ApiResponse<T = unknown> { status: number; body: T; }
const ok = <T>(body: T): ApiResponse<T> => ({ status: 200, body });
const missing = (): ApiResponse<{ error: string }> => ({ status: 404, body: { error: "not found" } });
const queryFilters = (query?: Record<string, unknown> | null) => Object.fromEntries(["countryCode", "gender", "weightClass", "rarity", "personType", "signatureMoveId"].filter(k => query?.[k] !== undefined).map(k => [k, query![k]]));
export function createRestHandlers({ catalog, draw }: { catalog: CatalogService; draw: DrawService }) {
  return {
    listJudoka: ({ query = {}, authorizedInternal = false }: ApiRequest = {}) => ok(catalog.searchJudoka({ query: String(query?.q ?? ""), filters: queryFilters(query) as never, exclude: query?.exclude === undefined ? [] : Array.isArray(query.exclude) ? query.exclude.map(String) : [String(query.exclude)], collection: query?.collection === undefined ? undefined : String(query.collection), includeHidden: query?.includeHidden === true, authorizedInternal })),
    getJudoka: ({ params = {}, query = {}, authorizedInternal = false }: ApiRequest = {}) => { const value = catalog.getJudoka(params?.id, { includeHidden: query?.includeHidden === true, authorizedInternal }); return value ? ok(value) : missing(); },
    listTechniques: () => ok(catalog.listTechniques()), getTechnique: ({ params = {} }: ApiRequest = {}) => { const value = catalog.getTechnique(params?.id); return value ? ok(value) : missing(); },
    listCountries: () => ok(catalog.listCountries()), listWeightCategories: () => ok(catalog.listWeightCategories()),
    draw: ({ body = {}, authorizedInternal = false }: ApiRequest = {}) => ok(draw.draw(body, { authorizedInternal })), version: () => ok(catalog.version())
  };
}
