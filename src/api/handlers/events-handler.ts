import type { EventDrawRequest } from "../../domain/types.js";
import type { RestCatalogDependency, RestEventDrawDependency } from "../router.js";
import { validateEventDrawBody, parseEventListQuery } from "../schemas.js";

type ErrorCode = "bad_request" | "forbidden" | "not_found" | "method_not_allowed" | "conflict" | "internal_error";

type Context = {
  json: (body: unknown, status?: number, headers?: HeadersInit) => Response;
  failure: (status: number, code: ErrorCode, message: string) => Response;
  namedPage: <T extends { id: string }>(name: string, records: T[], limit: number | undefined, cursor: string | undefined) => unknown;
};

export async function eventsListHandler(context: Context, url: URL, catalog: RestCatalogDependency): Promise<Response> {
  const query = parseEventListQuery(url.searchParams);
  return context.json(context.namedPage("events", catalog.listEvents(query), query.limit, query.cursor));
}

export async function eventsGetHandler(context: Context, url: URL, id: string, catalog: RestCatalogDependency): Promise<Response> {
  let hasQuery = false;
  url.searchParams.forEach(() => {
    hasQuery = true;
  });
  if (hasQuery) throw new TypeError("unsupported query parameter for event lookup");
  const event = catalog.getEvent(id);
  return event ? context.json(event) : context.failure(404, "not_found", "event not found");
}

export async function eventsDrawHandler(
  context: Context,
  request: Request,
  eventDraw: RestEventDrawDependency | undefined,
): Promise<Response> {
  if (!eventDraw) return context.failure(404, "not_found", "route not found");
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) {
    throw new TypeError("content-type must be application/json");
  }
  let body: EventDrawRequest;
  try {
    body = validateEventDrawBody(await request.json());
  } catch (error) {
    if (error instanceof SyntaxError) throw new TypeError("request body contains malformed JSON");
    throw error;
  }
  try {
    return context.json(eventDraw.draw(body));
  } catch (error) {
    if (error instanceof RangeError && /exceeds eligible pool size/.test(error.message)) {
      return context.failure(409, "conflict", "requested event exceeds the eligible pool");
    }
    throw error;
  }
}
