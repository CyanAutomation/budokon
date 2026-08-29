import type { CatalogService } from "../domain/catalog-service.js";
import type { DrawRequest, EventDrawRequest } from "../domain/types.js";
import type { DrawService } from "../draw/draw-service.js";
import type { EventDrawService } from "../draw/event-draw-service.js";
export interface ApiRequest<TBody = DrawRequest> { query?: Record<string, unknown> | null; params?: Record<string, string | undefined> | null; body?: TBody; authorizedInternal?: boolean; }
export interface ApiResponse<T = unknown> { status: number; body: T; }
const ok = <T>(body: T): ApiResponse<T> => ({ status: 200, body });
const missing = (): ApiResponse<{ error: string }> => ({ status: 404, body: { error: "not found" } });
const queryFilters = (query?: Record<string, unknown> | null) => Object.fromEntries(["countryCode", "gender", "weightClass", "rarity", "personType", "signatureMoveIds"].filter(k => query?.[k] !== undefined).map(k => [k, query![k]]));
export function createRestHandlers({ catalog, draw, eventDraw }: { catalog: CatalogService; draw: DrawService; eventDraw?: EventDrawService }) {
  return {
    listJudoka: ({ query = {}, authorizedInternal = false }: ApiRequest = {}) => ok(catalog.searchJudoka({ query: String(query?.q ?? ""), filters: queryFilters(query) as never, exclude: query?.exclude === undefined ? [] : Array.isArray(query.exclude) ? query.exclude.map(String) : [String(query.exclude)], includeHidden: query?.includeHidden === true, authorizedInternal })),
    getJudoka: ({ params = {}, query = {}, authorizedInternal = false }: ApiRequest = {}) => { const value = catalog.getJudoka(params?.id, { includeHidden: query?.includeHidden === true, authorizedInternal }); return value ? ok(value) : missing(); },
    listTechniques: () => ok(catalog.listTechniques()), getTechnique: ({ params = {} }: ApiRequest = {}) => { const value = catalog.getTechnique(params?.id); return value ? ok(value) : missing(); },
    listEvents: ({ query = {} }: ApiRequest = {}) => ok(catalog.listEvents({ ruleset: typeof query?.ruleset === "string" ? query.ruleset : undefined, category: typeof query?.category === "string" ? query.category : undefined })),
    getEvent: ({ params = {} }: ApiRequest = {}) => { const value = catalog.getEvent(params?.id); return value ? ok(value) : missing(); },
    drawEvent: ({ body }: ApiRequest<EventDrawRequest> = {}) => { if (!eventDraw) throw new Error("eventDraw service not configured"); return ok(eventDraw.draw(body!)); },
    listCountries: () => ok(catalog.listCountries()), listWeightCategories: () => ok(catalog.listWeightCategories()),
    draw: ({ body = {}, authorizedInternal = false }: ApiRequest<DrawRequest> = {}) => ok(draw.draw(body, { authorizedInternal })),
    version: () => ok(catalog.version()), status: () => ok(catalog.status())
  };
}
