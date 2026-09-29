import type { RestCatalogDependency } from "../router.js";
import { parsePageQuery } from "../schemas.js";
import type { RestHandlerContext as Context } from "./context.js";

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
