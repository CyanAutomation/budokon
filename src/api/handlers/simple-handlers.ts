import type { RestCatalogDependency } from "../router.js";
import type { SimpleRestHandlerContext as Context } from "./context.js";

export async function countriesHandler(context: Context, catalog: RestCatalogDependency): Promise<Response> {
  return context.json(catalog.listCountries());
}

export async function weightCategoriesHandler(context: Context, catalog: RestCatalogDependency): Promise<Response> {
  return context.json(catalog.listWeightCategories());
}

export async function versionHandler(context: Context, catalog: RestCatalogDependency): Promise<Response> {
  return context.json(catalog.version());
}

export async function statusHandler(context: Context, catalog: RestCatalogDependency): Promise<Response> {
  return context.json(catalog.status());
}

export async function coverageHandler(context: Context, catalog: RestCatalogDependency): Promise<Response> {
  return context.json(catalog.coverage());
}
