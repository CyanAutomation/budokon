import type { RequestContext } from "../domain/types.js";
import { rankDuplicateCandidates } from "../jev/duplicate-shortlist.js";
import type { EditorialReviewInput } from "../jev/editorial-review-contracts.js";
import { DEFAULT_SEMANTIC_SEARCH_MAX_CANDIDATES } from "../jev/semantic-search.js";
import { requireInternal, versioned, type JevToolDependencies, type SearchToolRequest } from "./tool-types.js";

export function createJevTools({ catalog, semanticSearch, editorialReview, queryInterpreter }: JevToolDependencies) {
  return {
    async semantic_search_judoka(
      { query, q, filters = {}, exclude = [], includeHidden, maxCandidates = DEFAULT_SEMANTIC_SEARCH_MAX_CANDIDATES }: SearchToolRequest & { maxCandidates?: number },
      context: RequestContext = {},
    ) {
      requireInternal(context);
      if (!semanticSearch) throw new Error("JEV semantic search is not configured");
      const candidates = catalog.listJudoka({ filters, exclude, includeHidden, authorizedInternal: context.authorizedInternal });
      if (candidates.length > maxCandidates) {
        throw new RangeError(`semantic search has ${candidates.length} eligible candidates; narrow with catalogue filters before using the ${maxCandidates}-candidate limit`);
      }
      return versioned(catalog, await semanticSearch.search(query ?? q ?? "", candidates));
    },
    async review_proposed_judoka(input: EditorialReviewInput, context: RequestContext = {}) {
      requireInternal(context);
      if (!editorialReview) throw new Error("JEV editorial review is not configured");
      const signatureMoveIds = Array.isArray(input.record?.signatureMoveIds) ? input.record.signatureMoveIds : [];
      const techniques = catalog.listTechniques().filter(technique => signatureMoveIds.includes(technique.id));
      const duplicateCandidates = input.duplicateCandidates ?? rankDuplicateCandidates(
        input.record,
        catalog.listJudoka({ includeHidden: true, authorizedInternal: context.authorizedInternal }),
      );
      return editorialReview.review({ ...input, duplicateCandidates, techniques });
    },
    async review_proposed_judoka_batch({ proposals }: { proposals: EditorialReviewInput[] }, context: RequestContext = {}) {
      requireInternal(context);
      if (!editorialReview) throw new Error("JEV editorial review is not configured");
      if (!editorialReview.reviewMany) throw new Error("JEV batch editorial review is not configured");
      const canonical = catalog.listJudoka({ includeHidden: true, authorizedInternal: context.authorizedInternal });
      const candidatePool = [...canonical, ...proposals.map(proposal => proposal.record)];
      const techniques = catalog.listTechniques();
      const prepared = proposals.map(proposal => ({
        ...proposal,
        duplicateCandidates: proposal.duplicateCandidates ?? rankDuplicateCandidates(proposal.record, candidatePool),
        techniques: techniques.filter(technique => proposal.record.signatureMoveIds.includes(technique.id)),
      }));
      return editorialReview.reviewMany(prepared);
    },
    async interpret_judoka_query({ query }: { query: string }, context: RequestContext = {}) {
      requireInternal(context);
      if (!queryInterpreter) throw new Error("JEV judoka query interpretation is not configured");
      const interpretation = await queryInterpreter.interpret(query, {
        countries: catalog.listCountries(),
        weightCategories: catalog.listWeightCategories(),
      });
      return versioned(catalog, interpretation);
    },
  };
}
