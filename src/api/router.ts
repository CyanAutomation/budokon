import type {
  Country, CoverageResponse, DrawRequest, DrawResponse, EventDrawRequest, EventDrawResponse,
  Filters, JudoEvent, Judoka, ListJudokaOptions, RequestContext, SearchJudokaOptions,
  StatusResponse, Technique, VersionResponse, WeightCategoryGroup
} from "../domain/types.js";
import {
  parsePageQuery,
  parseListQuery,
  parseEventListQuery,
  validateDrawBody,
  validateEventDrawBody,
} from "./schemas.js";
import { createQueryParser } from "./query-parser.js";
import { createBodyValidator } from "./body-validator.js";
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
}

type ErrorCode = "bad_request" | "forbidden" | "not_found" | "method_not_allowed" | "conflict" | "internal_error";
const json = (body: unknown, status = 200, headers: HeadersInit = {}) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json; charset=utf-8", ...headers }
});
const failure = (status: number, code: ErrorCode, message: string) => json({ error: { code, message } }, status);
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
  // Initialize middleware utilities
  const queryParser = createQueryParser();
  const bodyValidator = createBodyValidator();
  const authority = createRequestAuthority(options.authorizeInternal);

  // Create context object for handlers
  const createContext = () => ({
    json,
    failure,
    namedPage,
  });

  // Handler routing table: [resource, method?, id?] -> handler function
  const handlers = {
    judokaList: () => judokaListHandler(createContext(), new URL(""), catalog, false), // Will be called with proper params
    judokaGet: () => judokaGetHandler(createContext(), new URL(""), "", catalog, false),
    techniquesList: () => techniquesListHandler(createContext(), new URL(""), catalog),
    techniquesGet: () => techniquesGetHandler(createContext(), "", catalog),
    eventsList: () => eventsListHandler(createContext(), new URL(""), catalog),
    eventsGet: () => eventsGetHandler(createContext(), new URL(""), "", catalog),
    eventsDraw: () => eventsDrawHandler(createContext(), new Request("http://localhost"), eventDraw),
    countries: () => countriesHandler(createContext(), catalog),
    weightCategories: () => weightCategoriesHandler(createContext(), catalog),
    version: () => versionHandler(createContext(), catalog),
    status: () => statusHandler(createContext(), catalog),
    coverage: () => coverageHandler(createContext(), catalog),
    draw: () => drawHandler(createContext(), new Request("http://localhost"), draw, false),
  };

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
      const resource = segments[1]; const id = segments[2];
      if (segments.length > 3) return failure(404, "not_found", "route not found");

      const context = { json, failure, namedPage };

      if (resource === "judoka" && request.method === "GET") {
        return id !== undefined
          ? await judokaGetHandler(context, url, id, catalog, authorizedInternal)
          : await judokaListHandler(context, url, catalog, authorizedInternal);
      }
      if (resource === "techniques" && request.method === "GET") {
        return id !== undefined
          ? await techniquesGetHandler(context, id, catalog)
          : await techniquesListHandler(context, url, catalog);
      }
      if (resource === "events") {
        if (id === "draw" && request.method === "POST") {
          return await eventsDrawHandler(context, request, eventDraw);
        }
        if (id === "draw") return failure(405, "method_not_allowed", "method not allowed");
        if (request.method === "GET") {
          return id !== undefined
            ? await eventsGetHandler(context, url, id, catalog)
            : await eventsListHandler(context, url, catalog);
        }
      }
      if (resource === "countries" && request.method === "GET" && id === undefined) return await countriesHandler(context, catalog);
      if (resource === "weight-categories" && request.method === "GET" && id === undefined) return await weightCategoriesHandler(context, catalog);
      if (resource === "version" && request.method === "GET" && id === undefined) return await versionHandler(context, catalog);
      if (resource === "status" && request.method === "GET" && id === undefined) return await statusHandler(context, catalog);
      if (resource === "coverage" && request.method === "GET" && id === undefined) return await coverageHandler(context, catalog);
      if (resource === "draw" && request.method === "POST" && id === undefined) {
        return await drawHandler(context, request, draw, authorizedInternal);
      }
      const known = new Set(["judoka", "techniques", "events", "countries", "weight-categories", "draw", "version", "status", "coverage"]);
      return known.has(resource ?? "") ? failure(405, "method_not_allowed", "method not allowed") : failure(404, "not_found", "route not found");
    } catch (error) {
      const expectedInputError = error instanceof Error && /^(unsupported (query parameter|body field|filter|draw algorithm)|filter .+ must |includeHidden must |q must |limit must |cursor (must|requires) |content-type must |request body |count must |seed must |algorithm must |ruleset must |category must |exclude must )/.test(error.message);
      if (expectedInputError) return badRequest(error.message);
      return failure(500, "internal_error", "internal server error");
    }
  };
}
