import type { CoverageResponse, Filters, JudoEvent, Judoka, ListJudokaOptions, SearchJudokaOptions, StatusResponse, VersionResponse } from "./types.js";
import type { ReadModelRepository } from "../repository/read-model-repository.js";
import { createFilterService } from "./filter-service.js";
import { createSearchService } from "./search-service.js";
import { createMetadataService } from "./metadata-service.js";

/**
 * Main catalog service providing access to judoka, techniques, events, and metadata.
 * Coordinates filtering, searching, and metadata services.
 */
export class CatalogService {
  private filterService: ReturnType<typeof createFilterService>;
  private searchService: ReturnType<typeof createSearchService>;
  private metadataService: ReturnType<typeof createMetadataService>;

  constructor(readonly repository: ReadModelRepository) {
    this.filterService = createFilterService();
    this.searchService = createSearchService(this.filterService);
    this.metadataService = createMetadataService(this.repository);
  }

  version(): VersionResponse {
    return this.metadataService.version();
  }

  status(): StatusResponse {
    return this.metadataService.status();
  }

  coverage(): CoverageResponse {
    return this.metadataService.coverage(this.repository.listJudoka());
  }

  listJudoka(options: ListJudokaOptions = {}): Judoka[] {
    return this.filterService.applyFilters(
      this.repository.listJudoka(),
      options.filters,
      options.exclude,
      options.includeHidden,
      options.authorizedInternal
    );
  }

  searchJudoka(options: SearchJudokaOptions = {}): Judoka[] {
    return this.searchService.search(this.repository.listJudoka(), options);
  }

  getJudoka(
    id: string | undefined,
    options: Pick<ListJudokaOptions, "includeHidden" | "authorizedInternal"> = {}
  ): Judoka | undefined {
    const match = this.repository.getJudoka(id);
    return match && (match.isHidden !== true || (options.includeHidden === true && options.authorizedInternal === true))
      ? match
      : undefined;
  }

  listTechniques(): Technique[] {
    return this.repository.listTechniques();
  }

  getTechnique(id: string | undefined): Technique | undefined {
    return this.repository.getTechnique(id);
  }

  listEvents(options: { ruleset?: string; category?: string } = {}): JudoEvent[] {
    return this.repository.listEvents().filter(
      event =>
        (options.ruleset === undefined || event.ruleset === options.ruleset) &&
        (options.category === undefined || event.category === options.category)
    );
  }

  getEvent(id: string | undefined): JudoEvent | undefined {
    return this.repository.getEvent(id);
  }

  listCountries() {
    return this.repository.listCountries();
  }

  listWeightCategories() {
    return this.repository.listWeightCategories();
  }
}

// Import types needed for methods
import type { Technique } from "./types.js";
