import type { RestCatalogDependency } from "../router.js";

type ErrorCode = "bad_request" | "forbidden" | "not_found" | "method_not_allowed" | "conflict" | "internal_error";

type Context = {
  json: (body: unknown, status?: number, headers?: HeadersInit) => Response;
};

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
