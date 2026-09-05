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

      if (resource === "judoka" && request.method === "GET") {
        const query = queryParser.parseListQuery(url.searchParams);
        if (query.includeHidden && !authorizedInternal) return failure(403, "forbidden", "hidden records require internal authorization");
        if (id !== undefined) {
          let unsupportedLookupQuery = false;
          url.searchParams.forEach((_value, key) => { if (key !== "includeHidden") unsupportedLookupQuery = true; });
          if (unsupportedLookupQuery) throw new TypeError("unsupported query parameter for judoka lookup");
          const record = catalog.getJudoka(id, { includeHidden: query.includeHidden, authorizedInternal });
          return record ? json(record) : failure(404, "not_found", "judoka not found");
        }
        return json(namedPage("judoka", catalog.searchJudoka({ ...query, authorizedInternal }), query.limit, query.cursor));
      }
      if (resource === "techniques" && request.method === "GET") {
        if (id !== undefined) {
          const technique = catalog.getTechnique(id);
          return technique ? json(technique) : failure(404, "not_found", "technique not found");
        }
        const allowed = new Set(["limit", "cursor"]);
        url.searchParams.forEach((_value, key) => { if (!allowed.has(key)) throw new TypeError(`unsupported query parameter: ${key}`); });
        const page = queryParser.parsePageQuery(url.searchParams);
        return json(namedPage("techniques", catalog.listTechniques(), page.limit, page.cursor));
      }
      if (resource === "events") {
        if (id === "draw" && request.method === "POST") {
          if (!eventDraw) return failure(404, "not_found", "route not found");
          if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) throw new TypeError("content-type must be application/json");
          let body: EventDrawRequest; try { body = bodyValidator.validateEventDrawBody(await request.json()); } catch (error) { if (error instanceof SyntaxError) throw new TypeError("request body contains malformed JSON"); throw error; }
          try { return json(eventDraw.draw(body)); }
          catch (error) { if (error instanceof RangeError && /exceeds eligible pool size/.test(error.message)) return failure(409, "conflict", "requested event exceeds the eligible pool"); throw error; }
        }
        if (id === "draw") return failure(405, "method_not_allowed", "method not allowed");
        if (request.method === "GET") {
          if (id !== undefined) {
            let hasQuery = false; url.searchParams.forEach(() => { hasQuery = true; });
            if (hasQuery) throw new TypeError("unsupported query parameter for event lookup");
            const event = catalog.getEvent(id); return event ? json(event) : failure(404, "not_found", "event not found");
          }
          const query = queryParser.parseEventListQuery(url.searchParams);
          return json(namedPage("events", catalog.listEvents(query), query.limit, query.cursor));
        }
      }
      if (resource === "countries" && request.method === "GET" && id === undefined) return json(catalog.listCountries());
      if (resource === "weight-categories" && request.method === "GET" && id === undefined) return json(catalog.listWeightCategories());
      if (resource === "version" && request.method === "GET" && id === undefined) return json(catalog.version());
      if (resource === "status" && request.method === "GET" && id === undefined) return json(catalog.status());
      if (resource === "coverage" && request.method === "GET" && id === undefined) return json(catalog.coverage());
      if (resource === "draw" && request.method === "POST" && id === undefined) {
        if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) throw new TypeError("content-type must be application/json");
        let body: DrawRequest; try { body = bodyValidator.validateDrawBody(await request.json()); } catch (error) { if (error instanceof SyntaxError) throw new TypeError("request body contains malformed JSON"); throw error; }
        if (body.includeHidden && !authorizedInternal) return failure(403, "forbidden", "hidden records require internal authorization");
        try { return json(draw.draw(body, { authorizedInternal })); }
        catch (error) { if (error instanceof RangeError && /exceeds eligible pool size/.test(error.message)) return failure(409, "conflict", "requested count exceeds the eligible pool"); throw error; }
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
