/**
 * Metadata service for catalog version and status information.
 * Exposes deployment identity and coverage summaries.
 */

import type { CoverageResponse, Judoka, StatusResponse, VersionResponse } from "./types.js";
import type { ReadModelRepository } from "../repository/read-model-repository.js";
import { DRAW_ALGORITHM, SUPPORTED_DRAW_ALGORITHMS } from "../draw/algorithm.js";
import { summarizeCoverage } from "./coverage.js";

export interface MetadataService {
  /**
   * Get version information including dataset and service versions.
   */
  version(): VersionResponse;

  /**
   * Get status response with version and deployment identity.
   */
  status(): StatusResponse;

  /**
   * Get coverage summary of the judoka catalogue.
   */
  coverage(judoka: Judoka[]): CoverageResponse;
}

/**
 * Create a metadata service instance.
 */
export function createMetadataService(repository: ReadModelRepository): MetadataService {
  return {
    version(): VersionResponse {
      return {
        datasetVersion: repository.datasetVersion,
        serviceVersion: repository.serviceVersion,
        sourceGitCommit: repository.sourceGitCommit,
        datasetChecksum: repository.datasetChecksum,
        drawAlgorithms: [...SUPPORTED_DRAW_ALGORITHMS],
        defaultDrawAlgorithm: DRAW_ALGORITHM,
      };
    },

    status(): StatusResponse {
      return { status: "ok", ...this.version() };
    },

    coverage(judoka): CoverageResponse {
      return summarizeCoverage(judoka);
    },
  };
}
