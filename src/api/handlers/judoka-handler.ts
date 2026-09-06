import type { RestCatalogDependency } from "../router.js";
import type { ListQuerySchema } from "../schemas.js";
import { parseListQuery } from "../schemas.js";

type ErrorCode = "bad_request" | "forbidden" | "not_found" | "method_not_allowed" | "conflict" | "internal_error";

type Context = {
  json: (body: unknown, status?: number, headers?: HeadersInit) => Response;
  failure: (status: number, code: ErrorCode, message: string) => Response;
  namedPage: <T extends { id: string }>(name: string, records: T[], limit: number | undefined, cursor: string | undefined) => unknown;
};

export async function judokaListHandler(context: Context, url: URL, catalog: RestCatalogDependency, authorizedInternal: boolean): Promise<Response> {
  const query = parseListQuery(url.searchParams);
  if (query.includeHidden && !authorizedInternal) {
    return context.failure(403, "forbidden", "hidden records require internal authorization");
  }
  return context.json(context.namedPage("judoka", catalog.searchJudoka({ ...query, authorizedInternal }), query.limit, query.cursor));
}

export async function judokaGetHandler(context: Context, url: URL, id: string, catalog: RestCatalogDependency, authorizedInternal: boolean): Promise<Response> {
  let unsupportedLookupQuery = false;
  url.searchParams.forEach((_value, key) => {
    if (key !== "includeHidden") unsupportedLookupQuery = true;
  });
  if (unsupportedLookupQuery) throw new TypeError("unsupported query parameter for judoka lookup");
  const query = parseListQuery(url.searchParams);
  const record = catalog.getJudoka(id, { includeHidden: query.includeHidden, authorizedInternal });
  return record ? context.json(record) : context.failure(404, "not_found", "judoka not found");
}
