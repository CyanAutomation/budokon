import dataset from "../dist/budokon.json" with { type: "json" };
import manifest from "../dist/manifest.json" with { type: "json" };
import { CatalogService } from "../src/domain/catalog-service.js";
import { DrawService } from "../src/draw/draw-service.js";
import { EventDrawService } from "../src/draw/event-draw-service.js";
import { JsonReadModelRepository } from "../src/repository/json-read-model-repository.js";

const repository = new JsonReadModelRepository({ ...dataset, manifest });

export const catalog = new CatalogService(repository);
export const draw = new DrawService(catalog);
export const eventDraw = new EventDrawService(repository);
export { manifest };
