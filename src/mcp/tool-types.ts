import type { CatalogService } from "../domain/catalog-service.js";
import type { DrawRequest, Filters } from "../domain/types.js";
import type { DrawService } from "../draw/draw-service.js";
import type { EventDrawService } from "../draw/event-draw-service.js";
import type { EditorialReviewInput, EditorialReviewer } from "../jev/editorial-review-contracts.js";
import type { PlaystyleClassifier } from "../jev/playstyle-classification-contracts.js";
import type { JudokaQueryInterpreter } from "../jev/query-interpreter.js";
import type { SemanticJudokaSearcher } from "../jev/semantic-search.js";

export interface SearchToolRequest extends DrawRequest {
  query?: string;
  q?: string;
  filters?: Filters;
  limit?: number;
  cursor?: string;
}

export interface TechniqueSearchToolRequest {
  query?: string;
  category?: string | string[];
  subCategory?: string | string[];
  limit?: number;
  cursor?: string;
}

export interface McpToolDependencies {
  catalog: CatalogService;
  draw: DrawService;
  eventDraw?: EventDrawService;
  semanticSearch?: SemanticJudokaSearcher;
  editorialReview?: EditorialReviewer;
  playstyleClassification?: PlaystyleClassifier;
  queryInterpreter?: JudokaQueryInterpreter;
}

export interface JevToolDependencies extends Pick<McpToolDependencies, "catalog" | "semanticSearch" | "editorialReview" | "playstyleClassification" | "queryInterpreter"> {}

export interface CatalogToolDependencies extends Pick<McpToolDependencies, "catalog" | "draw" | "eventDraw"> {}

export function versioned<T extends object>(catalog: CatalogService, body: T) {
  return { datasetVersion: catalog.repository.datasetVersion, ...body };
}

export function requireJev(context: { authorizedInternal?: boolean; authorizedJev?: boolean }): void {
  if (context.authorizedInternal !== true && context.authorizedJev !== true) {
    throw new Error("internal authorization is required for JEV tools");
  }
}
