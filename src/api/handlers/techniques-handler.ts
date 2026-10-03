import type { RestCatalogDependency } from "../router.js";
import { parseTechniqueListQuery } from "../technique-list-query-schema.js";
import type { RestHandlerContext as Context } from "./context.js";

export async function techniquesListHandler(context: Context, url: URL, catalog: RestCatalogDependency): Promise<Response> {
  const query = parseTechniqueListQuery(url.searchParams);
  return context.json(context.namedPage("techniques", catalog.searchTechniques(query), query.limit, query.cursor));
}

export async function techniquesGetHandler(context: Context, id: string, catalog: RestCatalogDependency): Promise<Response> {
  const technique = catalog.getTechnique(id);
  return technique ? context.json(technique) : context.failure(404, "not_found", "technique not found");
}
