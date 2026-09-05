import type { EventDrawRequest, EventDrawResponse, JudoEvent } from "../domain/types.js";
import type { ReadModelRepository } from "../repository/read-model-repository.js";
import { createSeededRandom } from "./seeded-random.js";

export const EVENT_DRAW_ALGORITHM = "budokon-event-v1";

/** Select one immutable event; applying its effects remains the consuming game's responsibility. */
export class EventDrawService {
  constructor(readonly repository: ReadModelRepository, private readonly random: () => number = Math.random) {}
  draw(input: EventDrawRequest): EventDrawResponse {
    const ruleset = String(input.ruleset ?? "").trim();
    if (!ruleset) throw new RangeError("ruleset must be a non-empty string");
    const category = input.category === undefined ? undefined : String(input.category).trim();
    if (category === "") throw new RangeError("category must be a non-empty string");
    const exclude = [...new Set((input.exclude ?? []).map(String))].sort();
    const pool = this.repository.listEvents().filter(event => event.ruleset === ruleset && (category === undefined || event.category === category) && !exclude.includes(event.id)).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    if (!pool.length) throw new RangeError("requested event exceeds eligible pool size");
    const seed = input.seed === undefined ? undefined : String(input.seed);
    const random = seed === undefined ? this.random : createSeededRandom(JSON.stringify({ version: this.repository.datasetVersion, ruleset, ...(category === undefined ? {} : { category }), exclude, seed }));
    const event: JudoEvent = pool[Math.floor(random() * pool.length)]!;
    return { datasetVersion: this.repository.datasetVersion, algorithm: EVENT_DRAW_ALGORITHM, ...(seed === undefined ? {} : { seed }), poolSize: pool.length, event };
  }
}
