import type {
  Country,
  CoverageResponse,
  DrawRequest,
  DrawResponse,
  EventDrawRequest,
  EventDrawResponse,
  JudoEvent,
  Judoka,
  ListJudokaOptions,
  RequestContext,
  SearchJudokaOptions,
  StatusResponse,
  Technique,
  VersionResponse,
  WeightCategoryGroup,
} from "../domain/types.js";
import { createRequestAuthority } from "./request-authority.js";
import { createResourceRouter } from "./resource-router.js";
import { badRequest, failure, isExpectedInputError } from "./router-response.js";

export interface RestCatalogDependency {
  searchJudoka(options?: SearchJudokaOptions): Judoka[];
  getJudoka(id: string | undefined, options?: Pick<ListJudokaOptions, "includeHidden" | "authorizedInternal">): Judoka | undefined;
  listTechniques(): Technique[];
  getTechnique(id: string | undefined): Technique | undefined;
  listEvents(options?: { ruleset?: string; category?: string }): JudoEvent[];
  getEvent(id: string | undefined): JudoEvent | undefined;
  listCountries(): Record<string, Country>;
  listWeightCategories(): WeightCategoryGroup[];
  version(): VersionResponse;
  status(): StatusResponse;
  coverage(): CoverageResponse;
}

export interface RestDrawDependency {
  draw(input?: DrawRequest, context?: RequestContext): DrawResponse;
}

export interface RestEventDrawDependency {
  draw(input: EventDrawRequest): EventDrawResponse;
}

export interface RestRouterOptions {
  /** Resolve deployment-specific credentials without coupling the router to a platform. */
  authorizeInternal?: (request: Request) => boolean | Promise<boolean>;
  /** Report whether this request can produce an internal-only representation. */
  onRepresentation?: (metadata: { cacheablePublicly: boolean }) => void;
}

export function createRestRouter(
  dependencies: { catalog: RestCatalogDependency; draw: RestDrawDependency; eventDraw?: RestEventDrawDependency },
  options: RestRouterOptions = {},
) {
  const authority = createRequestAuthority(options.authorizeInternal);
  const routeResource = createResourceRouter(dependencies);

  return async function route(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      let segments: string[];
      try {
        segments = url.pathname.split("/").filter(Boolean).map(segment => decodeURIComponent(segment));
      } catch {
        return badRequest("path contains invalid encoding");
      }

      if (segments[0] !== "v1") return failure(404, "not_found", "route not found");
      let authorizedInternal = false;
      try {
        authorizedInternal = await authority.isAuthorizedInternal(request);
      } catch {
        return failure(500, "internal_error", "internal server error");
      }

      options.onRepresentation?.({
        cacheablePublicly: !authorizedInternal && !url.searchParams.getAll("includeHidden").includes("true"),
      });
      const [resource, id, ...extraSegments] = segments.slice(1);
      if (extraSegments.length > 0) return failure(404, "not_found", "route not found");
      return await routeResource(resource, id, request, url, authorizedInternal);
    } catch (error) {
      if (isExpectedInputError(error)) return badRequest(error.message);
      return failure(500, "internal_error", "internal server error");
    }
  };
}
