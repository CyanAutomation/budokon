import type {
  RestCatalogDependency,
  RestDrawDependency,
  RestEventDrawDependency,
} from "./router.js";
import type { RestHandlerContext } from "./handlers/context.js";
import { drawHandler } from "./handlers/draw-handler.js";
import { eventsDrawHandler, eventsGetHandler, eventsListHandler } from "./handlers/events-handler.js";
import { judokaGetHandler, judokaListHandler } from "./handlers/judoka-handler.js";
import { countriesHandler, coverageHandler, publicCoverageHandler, statusHandler, versionHandler, weightCategoriesHandler } from "./handlers/simple-handlers.js";
import { techniquesGetHandler, techniquesListHandler } from "./handlers/techniques-handler.js";
import { failure, json, methodNotAllowed, namedPage } from "./router-response.js";

export interface ResourceRouterDependencies {
  catalog: RestCatalogDependency;
  draw: RestDrawDependency;
  eventDraw?: RestEventDrawDependency;
}

export function createResourceRouter({ catalog, draw, eventDraw }: ResourceRouterDependencies) {
  const context: RestHandlerContext = { json, failure, namedPage };
  const singletonHandlers: Record<string, () => Promise<Response>> = {
    countries: () => countriesHandler(context, catalog),
    "weight-categories": () => weightCategoriesHandler(context, catalog),
    version: () => versionHandler(context, catalog),
    status: () => statusHandler(context, catalog),
    coverage: () => coverageHandler(context, catalog),
  };

  async function routeJudoka(
    id: string | undefined,
    request: Request,
    url: URL,
    authorizedInternal: boolean,
  ): Promise<Response> {
    if (request.method !== "GET") return methodNotAllowed("GET");
    return id === undefined
      ? judokaListHandler(context, url, catalog, authorizedInternal)
      : judokaGetHandler(context, url, id, catalog, authorizedInternal);
  }

  async function routeTechniques(id: string | undefined, request: Request, url: URL): Promise<Response> {
    if (request.method !== "GET") return methodNotAllowed("GET");
    return id === undefined
      ? techniquesListHandler(context, url, catalog)
      : techniquesGetHandler(context, id, catalog);
  }

  async function routeEvents(id: string | undefined, request: Request, url: URL): Promise<Response> {
    if (id === "draw") {
      return request.method === "POST"
        ? eventsDrawHandler(context, request, eventDraw)
        : methodNotAllowed("POST");
    }
    if (request.method !== "GET") return methodNotAllowed("GET");
    return id === undefined
      ? eventsListHandler(context, url, catalog)
      : eventsGetHandler(context, url, id, catalog);
  }

  async function routeCollection(
    resource: string | undefined,
    id: string | undefined,
    request: Request,
    url: URL,
    authorizedInternal: boolean,
  ): Promise<Response | undefined> {
    if (resource === "judoka") return routeJudoka(id, request, url, authorizedInternal);
    if (resource === "techniques") return routeTechniques(id, request, url);
    if (resource === "events") return routeEvents(id, request, url);
    return undefined;
  }

  async function routeSingleton(resource: string | undefined, id: string | undefined, method: string): Promise<Response | undefined> {
    if (resource === "coverage" && id === "public") {
      return method === "GET" ? publicCoverageHandler(context, catalog) : methodNotAllowed("GET");
    }
    if (id !== undefined || resource === undefined) return undefined;
    const handler = singletonHandlers[resource];
    if (!handler) return undefined;
    return method === "GET" ? handler() : methodNotAllowed("GET");
  }

  async function routeDraw(
    resource: string | undefined,
    id: string | undefined,
    request: Request,
    authorizedInternal: boolean,
  ): Promise<Response | undefined> {
    if (resource !== "draw" || id !== undefined) return undefined;
    return request.method === "POST"
      ? drawHandler(context, request, draw, authorizedInternal)
      : methodNotAllowed("POST");
  }

  return async function routeResource(
    resource: string | undefined,
    id: string | undefined,
    request: Request,
    url: URL,
    authorizedInternal: boolean,
  ): Promise<Response> {
    const collection = await routeCollection(resource, id, request, url, authorizedInternal);
    if (collection) return collection;
    const singleton = await routeSingleton(resource, id, request.method);
    if (singleton) return singleton;
    const drawResponse = await routeDraw(resource, id, request, authorizedInternal);
    return drawResponse ?? failure(404, "not_found", "route not found");
  };
}
