import type { RestHandlerErrorCode } from "./handlers/context.js";

export function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

export function failure(
  status: number,
  code: RestHandlerErrorCode,
  message: string,
  headers: HeadersInit = {},
): Response {
  return json({ error: { code, message } }, status, headers);
}

export function methodNotAllowed(method: "GET" | "POST"): Response {
  return failure(405, "method_not_allowed", "method not allowed", { allow: method });
}

export function badRequest(message: string): Response {
  return failure(400, "bad_request", message);
}

function paginate<T extends { id: string }>(records: T[], limit: number | undefined, cursor: string | undefined) {
  if (limit === undefined && cursor === undefined) return records;
  if (limit === undefined) throw new TypeError("cursor requires limit");

  const cursorIndex = cursor === undefined ? undefined : records.findIndex(record => record.id === cursor);
  if (cursorIndex === -1) throw new TypeError("cursor must identify a valid result from the current query");
  const index = cursorIndex === undefined ? 0 : cursorIndex + 1;
  const items = records.slice(index, index + limit);
  return {
    items,
    nextCursor: index + items.length < records.length ? items.at(-1)?.id : undefined,
  };
}

export function namedPage<T extends { id: string }>(
  name: string,
  records: T[],
  limit: number | undefined,
  cursor: string | undefined,
): unknown {
  const result = paginate(records, limit, cursor);
  return Array.isArray(result) ? result : { [name]: result.items, nextCursor: result.nextCursor };
}

export function isExpectedInputError(error: unknown): error is Error {
  return error instanceof Error && /^(unsupported (query parameter|body field|filter|draw algorithm)|filter .+ must |includeHidden must |q must |query must |limit must |cursor (must|requires) |content-type must |request body |count must |seed must |algorithm must |ruleset must |category must |subCategory must |exclude must )/.test(error.message);
}
