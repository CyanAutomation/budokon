import { normalizeFilters, type CatalogService } from "../domain/catalog-service.js";
import type { DrawRequest, DrawResponse, RequestContext } from "../domain/types.js";
function seededRandom(seed: string) { let state = 2166136261; for (const character of seed) { state ^= character.codePointAt(0)!; state = Math.imul(state, 16777619); } return () => { state += 0x6d2b79f5; let n = state; n = Math.imul(n ^ n >>> 15, n | 1); n ^= n + Math.imul(n ^ n >>> 7, n | 61); return ((n ^ n >>> 14) >>> 0) / 4294967296; }; }
export class DrawService {
  constructor(readonly catalog: CatalogService, private readonly random: () => number = Math.random) {}
  draw(input: DrawRequest = {}, context: RequestContext = {}): DrawResponse {
    const count = input.count ?? 1; if (!Number.isSafeInteger(count) || count < 1) throw new RangeError("count must be a positive integer");
    const filters = normalizeFilters(input.filters); const exclude = [...new Set((input.exclude ?? []).map(String))].sort();
    const collection = input.collection === undefined ? undefined : String(input.collection);
    const pool = this.catalog.listJudoka({ collection, filters, exclude, includeHidden: input.includeHidden, authorizedInternal: context.authorizedInternal }).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    if (count > pool.length) throw new RangeError(`count ${count} exceeds eligible pool size ${pool.length}`);
    const seed = input.seed === undefined ? undefined : String(input.seed); const random = seed === undefined ? this.random : seededRandom(JSON.stringify({ version: this.catalog.repository.datasetVersion, collection, filters, exclude, count, seed }));
    const remaining = pool.slice(); const judoka = []; while (judoka.length < count) judoka.push(remaining.splice(Math.floor(random() * remaining.length), 1)[0]!);
    return { datasetVersion: this.catalog.repository.datasetVersion, ...(seed === undefined ? {} : { seed }), poolSize: pool.length, judoka };
  }
}
