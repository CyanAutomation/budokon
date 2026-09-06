import type { RestCatalogDependency } from "../router.js";
import { parsePageQuery } from "../schemas.js";

type ErrorCode = "bad_request" | "forbidden" | "not_found" | "method_not_allowed" | "conflict" | "internal_error";

type Context = {
  json: (body: unknown, status?: number, headers?: HeadersInit) => Response;
  failure: (status: number, code: ErrorCode, message: string) => Response;
  namedPage: <T extends { id: string }>(name: string, records: T[], limit: number | undefined, cursor: string | undefined) => unknown;
};

export async function techniquesListHandler(context: Context, url: URL, catalog: RestCatalogDependency): Promise<Response> {
  const allowed = new Set(["limit", "cursor"]);
  url.searchParams.forEach((_value, key) => {
    if (!allowed.has(key)) throw new TypeError(`unsupported query parameter: ${key}`);
  });
  const page = parsePageQuery(url.searchParams);
  return context.json(context.namedPage("techniques", catalog.listTechniques(), page.limit, page.cursor));
}

export async function techniquesGetHandler(context: Context, id: string, catalog: RestCatalogDependency): Promise<Response> {
  const technique = catalog.getTechnique(id);
  return technique ? context.json(technique) : context.failure(404, "not_found", "technique not found");
}
