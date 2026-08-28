import { normalizeFilters, type CatalogService } from "../domain/catalog-service.js";
import type { DrawRequest, DrawResponse, RequestContext } from "../domain/types.js";
import { DRAW_ALGORITHM, SUPPORTED_DRAW_ALGORITHMS } from "./algorithm.js";
export { DRAW_ALGORITHM, SUPPORTED_DRAW_ALGORITHMS } from "./algorithm.js";

/**
 * Frozen budokon-v1 procedure (changes to any step require a new identifier):
 * 1. Default count to one and require a positive safe integer.
 * 2. Normalize filter keys in UTF-16 code-unit order; stringify, trim, de-duplicate,
 *    and order each filter's values. A candidate must have every filtered field and
 *    its string value must equal one allowed value.
 * 3. Hide hidden records unless both visibility flags are true. Exclusions are
 *    stringified, de-duplicated, ordered, and match either UUID or slug.
 * 4. Order the resulting pool by UUID using JavaScript's locale-independent UTF-16
 *    relational comparison.
 * 5. For seeded draws, encode exactly JSON.stringify({version, filters,
 *    exclude, count, seed}) in that property order. FNV-1a consumes Unicode code
 *    points (not UTF-8 bytes), with 32-bit Math.imul arithmetic. Each random value
 *    then uses Mulberry32's unsigned 32-bit arithmetic below and division by 2^32.
 *    Unseeded draws consume the injected random source (Math.random by default).
 * 6. Repeatedly select floor(random * remaining.length), removing that element
 *    before the next sample. Removal makes duplicates impossible.
 */
function seededRandom(seed: string) { let state = 2166136261; for (const character of seed) { state ^= character.codePointAt(0)!; state = Math.imul(state, 16777619); } return () => { state += 0x6d2b79f5; let n = state; n = Math.imul(n ^ n >>> 15, n | 1); n ^= n + Math.imul(n ^ n >>> 7, n | 61); return ((n ^ n >>> 14) >>> 0) / 4294967296; }; }
export class DrawService {
  constructor(readonly catalog: CatalogService, private readonly random: () => number = Math.random) {}
  draw(input: DrawRequest = {}, context: RequestContext = {}): DrawResponse {
    const algorithm = input.algorithm ?? DRAW_ALGORITHM;
    if (!SUPPORTED_DRAW_ALGORITHMS.includes(algorithm)) throw new RangeError(`unsupported draw algorithm: ${algorithm}`);
    const count = input.count ?? 1; if (!Number.isSafeInteger(count) || count < 1) throw new RangeError("count must be a positive integer");
    const filters = normalizeFilters(input.filters); const exclude = [...new Set((input.exclude ?? []).map(String))].sort();
    const pool = this.catalog.listJudoka({ filters, exclude, includeHidden: input.includeHidden, authorizedInternal: context.authorizedInternal }).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    if (count > pool.length) throw new RangeError(`count ${count} exceeds eligible pool size ${pool.length}`);
    const seed = input.seed === undefined ? undefined : String(input.seed); const random = seed === undefined ? this.random : seededRandom(JSON.stringify({ version: this.catalog.repository.datasetVersion, filters, exclude, count, seed }));
    const remaining = pool.slice(); const judoka = []; while (judoka.length < count) judoka.push(remaining.splice(Math.floor(random() * remaining.length), 1)[0]!);
    return { datasetVersion: this.catalog.repository.datasetVersion, algorithm: DRAW_ALGORITHM, ...(seed === undefined ? {} : { seed }), poolSize: pool.length, judoka };
  }
}
