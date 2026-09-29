import type {
  Country, CoverageResponse, DrawRequest, DrawResponse, EventDrawRequest, EventDrawResponse,
  Filters, JudoEvent, Judoka, ListJudokaOptions, RequestContext, SearchJudokaOptions,
  StatusResponse, Technique, VersionResponse, WeightCategoryGroup
} from "../domain/types.js";
import { createRequestAuthority } from "./request-authority.js";
import { judokaListHandler, judokaGetHandler } from "./handlers/judoka-handler.js";
import { techniquesListHandler, techniquesGetHandler } from "./handlers/techniques-handler.js";
import { eventsListHandler, eventsGetHandler, eventsDrawHandler } from "./handlers/events-handler.js";
import { countriesHandler, weightCategoriesHandler, versionHandler, statusHandler, coverageHandler } from "./handlers/simple-handlers.js";
import { drawHandler } from "./handlers/draw-handler.js";

export interface RestCatalogDependency {
  searchJudoka(options?: SearchJudokaOptions): Judoka[];
  getJudoka(id: string | undefined, options?: Pick<ListJudokaOptions, "includeHidden" | "authorizedInternal">): Judoka | undefined;
  listTechniques(): Technique[];
  getTechnique(id: string | undefined): Technique | undefined;
  listEvents(options?: { ruleset?: string; category?: string }): JudoEvent[];
  getEvent(id: string | undefined): JudoEvent | undefined;
  listCountries(): Record<string, Country>;
  listWeightCategories(): WeightCategoryGroup[];
  version(): VersionResponse;
  status(): StatusResponse;
  coverage(): CoverageResponse;
}

export interface RestDrawDependency {
  draw(input?: DrawRequest, context?: RequestContext): DrawResponse;
}

export interface RestEventDrawDependency {
  draw(input: EventDrawRequest): EventDrawResponse;
}

export interface RestRouterOptions {
  /** Resolve deployment-specific credentials without coupling the router to a platform. */
  authorizeInternal?: (request: Request) => boolean | Promise<boolean>;
  /** Report whether this request can produce an internal-only representation. */
  onRepresentation?: (metadata: { cacheablePublicly: boolean }) => void;
}

type ErrorCode = "bad_request" | "forbidden" | "not_found" | "method_not_allowed" | "conflict" | "internal_error";
const json = (body: unknown, status = 200, headers: HeadersInit = {}) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json; charset=utf-8", ...headers }
});
const failure = (status: number, code: ErrorCode, message: string, headers: HeadersInit = {}) => json({ error: { code, message } }, status, headers);
const methodNotAllowed = (allow: "GET" | "POST") => failure(405, "method_not_allowed", "method not allowed", { allow });
const badRequest = (message: string) => failure(400, "bad_request", message);

function paginate<T extends { id: string }>(records: T[], limit: number | undefined, cursor: string | undefined) {
  if (limit === undefined && cursor === undefined) return records;
  if (limit === undefined) throw new TypeError("cursor requires limit");
  const cursorIndex = cursor === undefined ? undefined : records.findIndex(record => record.id === cursor);
  if (cursorIndex === -1) throw new TypeError("cursor must identify a valid result from the current query");
  const index = cursorIndex === undefined ? 0 : cursorIndex + 1;
  const items = records.slice(index, index + limit);
  return { items, nextCursor: index + items.length < records.length ? items.at(-1)?.id : undefined };
}

function namedPage<T extends { id: string }>(name: string, records: T[], limit: number | undefined, cursor: string | undefined) {
  const result = paginate(records, limit, cursor);
  return Array.isArray(result) ? result : { [name]: result.items, nextCursor: result.nextCursor };
}

/** Create a runtime-neutral Fetch API handler backed exclusively by application services. */
export function createRestRouter({ catalog, draw, eventDraw }: { catalog: RestCatalogDependency; draw: RestDrawDependency; eventDraw?: RestEventDrawDependency }, options: RestRouterOptions = {}) {
  const authority = createRequestAuthority(options.authorizeInternal);
  const context = {
    json,
    failure,
    namedPage,
  };
  const singletonHandlers: Record<string, () => Promise<Response>> = {
    countries: () => countriesHandler(context, catalog),
    "weight-categories": () => weightCategoriesHandler(context, catalog),
    version: () => versionHandler(context, catalog),
    status: () => statusHandler(context, catalog),
    coverage: () => coverageHandler(context, catalog),
  };

  async function routeJudoka(
    id: string | undefined,
    request: Request,
    url: URL,
    authorizedInternal: boolean,
  ): Promise<Response | undefined> {
    if (request.method !== "GET") return methodNotAllowed("GET");
    return id === undefined
      ? judokaListHandler(context, url, catalog, authorizedInternal)
      : judokaGetHandler(context, url, id, catalog, authorizedInternal);
  }

  async function routeTechniques(id: string | undefined, request: Request, url: URL): Promise<Response> {
    if (request.method !== "GET") return methodNotAllowed("GET");
    return id === undefined
      ? techniquesListHandler(context, url, catalog)
      : techniquesGetHandler(context, id, catalog);
  }

  async function routeEvents(id: string | undefined, request: Request, url: URL): Promise<Response> {
    if (id === "draw") {
      return request.method === "POST"
        ? eventsDrawHandler(context, request, eventDraw)
        : methodNotAllowed("POST");
    }
    if (request.method !== "GET") return methodNotAllowed("GET");
    return id === undefined
      ? eventsListHandler(context, url, catalog)
      : eventsGetHandler(context, url, id, catalog);
  }

  async function routeCollection(
    resource: string | undefined,
    id: string | undefined,
    request: Request,
    url: URL,
    authorizedInternal: boolean,
  ): Promise<Response | undefined> {
    if (resource === "judoka") return routeJudoka(id, request, url, authorizedInternal);
    if (resource === "techniques") return routeTechniques(id, request, url);
    if (resource === "events") return routeEvents(id, request, url);
    return undefined;
  }

  async function routeSingleton(resource: string | undefined, id: string | undefined, method: string): Promise<Response | undefined> {
    if (id !== undefined || resource === undefined) return undefined;
    const handler = singletonHandlers[resource];
    if (!handler) return undefined;
    return method === "GET" ? handler() : methodNotAllowed("GET");
  }

  async function routeDraw(
    resource: string | undefined,
    id: string | undefined,
    request: Request,
    authorizedInternal: boolean,
  ): Promise<Response | undefined> {
    if (resource !== "draw" || id !== undefined) return undefined;
    return request.method === "POST"
      ? drawHandler(context, request, draw, authorizedInternal)
      : methodNotAllowed("POST");
  }

  async function routeResource(
    resource: string | undefined,
    id: string | undefined,
    request: Request,
    url: URL,
    authorizedInternal: boolean,
  ): Promise<Response> {
    const collection = await routeCollection(resource, id, request, url, authorizedInternal);
    if (collection) return collection;
    const singleton = await routeSingleton(resource, id, request.method);
    if (singleton) return singleton;
    const drawResponse = await routeDraw(resource, id, request, authorizedInternal);
    return drawResponse ?? failure(404, "not_found", "route not found");
  }

  return async function route(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      let segments: string[];
      try { segments = url.pathname.split("/").filter(Boolean).map(segment => decodeURIComponent(segment)); }
      catch { return badRequest("path contains invalid encoding"); }
      if (segments[0] !== "v1") return failure(404, "not_found", "route not found");
      let authorizedInternal = false;
      try { authorizedInternal = await authority.isAuthorizedInternal(request); }
      catch { return failure(500, "internal_error", "internal server error"); }
      options.onRepresentation?.({
        cacheablePublicly: !authorizedInternal && !url.searchParams.getAll("includeHidden").includes("true"),
      });
      const resource = segments[1]; const id = segments[2];
      if (segments.length > 3) return failure(404, "not_found", "route not found");
      return await routeResource(resource, id, request, url, authorizedInternal);
    } catch (error) {
      const expectedInputError = error instanceof Error && /^(unsupported (query parameter|body field|filter|draw algorithm)|filter .+ must |includeHidden must |q must |limit must |cursor (must|requires) |content-type must |request body |count must |seed must |algorithm must |ruleset must |category must |exclude must )/.test(error.message);
      if (expectedInputError) return badRequest(error.message);
      return failure(500, "internal_error", "internal server error");
    }
  };
}
