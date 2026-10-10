import type { RequestContext } from "../domain/types.js";
import { rankDuplicateCandidates } from "../jev/duplicate-shortlist.js";
import type { EditorialReviewInput } from "../jev/editorial-review-contracts.js";
import { requireJev, type JevToolDependencies } from "./tool-types.js";

export function createJevReviewTools({ catalog, editorialReview }: JevToolDependencies) {
  return {
    async review_proposed_judoka(input: EditorialReviewInput, context: RequestContext = {}) {
      requireJev(context);
      if (!editorialReview) throw new Error("JEV editorial review is not configured");
      const signatureMoveIds = Array.isArray(input.record?.signatureMoveIds) ? input.record.signatureMoveIds : [];
      const techniques = catalog.listTechniques().filter(technique => signatureMoveIds.includes(technique.id));
      const duplicateCandidates = input.duplicateCandidates ?? rankDuplicateCandidates(
        input.record,
        catalog.listJudoka({ includeHidden: context.authorizedInternal === true, authorizedInternal: context.authorizedInternal }),
      );
      return editorialReview.review({ ...input, duplicateCandidates, techniques });
    },
    async review_proposed_judoka_batch({ proposals }: { proposals: EditorialReviewInput[] }, context: RequestContext = {}) {
      requireJev(context);
      if (!editorialReview) throw new Error("JEV editorial review is not configured");
      if (!editorialReview.reviewMany) throw new Error("JEV batch editorial review is not configured");
      const canonical = catalog.listJudoka({ includeHidden: context.authorizedInternal === true, authorizedInternal: context.authorizedInternal });
      const candidatePool = [...canonical, ...proposals.map(proposal => proposal.record)];
      const techniques = catalog.listTechniques();
      const prepared = proposals.map(proposal => ({
        ...proposal,
        duplicateCandidates: proposal.duplicateCandidates ?? rankDuplicateCandidates(proposal.record, candidatePool),
        techniques: techniques.filter(technique => proposal.record.signatureMoveIds.includes(technique.id)),
      }));
      return editorialReview.reviewMany(prepared);
    },
  };
}
