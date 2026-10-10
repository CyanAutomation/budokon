import type { RequestContext } from "../domain/types.js";
import type { PlaystyleEditorialRatings, PlaystyleJudokaRecord } from "../jev/playstyle-classification-contracts.js";
import { requireJev, versioned, type JevToolDependencies } from "./tool-types.js";

export function createJevPlaystyleTools({ catalog, playstyleClassification }: JevToolDependencies) {
  return {
    async review_judoka_playstyle(
      { judokaId, evidence = [] }: { judokaId: string; evidence?: Array<{ url: string; excerpt: string }> },
      context: RequestContext = {},
    ) {
      requireJev(context);
      if (!playstyleClassification) throw new Error("JEV playstyle classification is not configured");
      const record = catalog.getJudoka(judokaId, { includeHidden: context.authorizedInternal === true, authorizedInternal: context.authorizedInternal });
      if (!record) throw new Error("judoka not found");
      const techniques = record.signatureMoveIds.map(id => catalog.getTechnique(id)).filter((technique): technique is NonNullable<typeof technique> => technique !== undefined);
      const source = record as unknown as Record<string, unknown>;
      const bio = record.bio;
      if (typeof bio !== "string" || bio.trim().length === 0) {
        throw new TypeError("judoka biography must be a non-empty string");
      }
      if (bio.length > 8_000) {
        throw new RangeError("judoka biography must be at most 8000 characters");
      }
      const inputRecord: PlaystyleJudokaRecord = {
        id: record.id,
        slug: record.slug,
        ...(typeof record.firstname === "string" ? { firstname: record.firstname } : {}),
        ...(typeof record.surname === "string" ? { surname: record.surname } : {}),
        bio,
        signatureMoveIds: [...record.signatureMoveIds],
        stats: source.stats as PlaystyleEditorialRatings | undefined,
      };
      return versioned(catalog, await playstyleClassification.classify({ record: inputRecord, evidence, techniques }));
    },
  };
}
