import { readFile } from "node:fs/promises";
import { JsonReadModelRepository } from "../repository/json-read-model-repository.js";

/** Optional Node deployment adapter; portable consumers should import or bundle budokon.json directly. */
export async function loadJsonReadModel(url: string | URL = new URL("../../dist/budokon.json", import.meta.url)): Promise<JsonReadModelRepository> {
  try { return new JsonReadModelRepository(await readFile(url, "utf8")); }
  catch (error) { throw new Error(`Failed to load read model: ${error instanceof Error ? error.message : String(error)}`, { cause: error }); }
}
