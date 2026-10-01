import { createCatalogTools } from "./catalog-tools.js";
import { createJevTools } from "./jev-tools.js";
import type { McpToolDependencies } from "./tool-types.js";

/** Compose catalogue and internal JEV operations into the server's tool map. */
export function createMcpTools(dependencies: McpToolDependencies) {
  return {
    ...createCatalogTools(dependencies),
    ...createJevTools(dependencies),
  };
}
