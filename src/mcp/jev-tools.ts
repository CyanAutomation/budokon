import type { JevToolDependencies } from "./tool-types.js";
import { createJevPlaystyleTools } from "./jev-playstyle-tools.js";
import { createJevReviewTools } from "./jev-review-tools.js";
import { createJevSearchTools } from "./jev-search-tools.js";

/** Compose JEV operations while keeping search, review, and playstyle logic separate. */
export function createJevTools(dependencies: JevToolDependencies) {
  const search = createJevSearchTools(dependencies);
  const review = createJevReviewTools(dependencies);
  const playstyle = createJevPlaystyleTools(dependencies);
  return {
    semantic_search_judoka: search.semantic_search_judoka,
    review_proposed_judoka: review.review_proposed_judoka,
    review_judoka_playstyle: playstyle.review_judoka_playstyle,
    review_proposed_judoka_batch: review.review_proposed_judoka_batch,
    interpret_judoka_query: search.interpret_judoka_query,
  };
}
