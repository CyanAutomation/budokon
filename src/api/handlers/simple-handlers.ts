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
  return context.json(catalog.coverage(), 200, {
    deprecation: "true",
    sunset: "Fri, 15 Jan 2027 00:00:00 GMT",
    link: '</v1/coverage/public>; rel="successor-version"',
  });
}

export async function publicCoverageHandler(context: Context, catalog: RestCatalogDependency): Promise<Response> {
  return context.json(catalog.publicCoverage());
}
