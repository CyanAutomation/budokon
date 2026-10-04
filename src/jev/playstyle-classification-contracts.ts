import type { Technique } from "../domain/types.js";
import type { ApprovedPlaystyleOption, PlaystyleFacet, PlaystyleOption } from "../domain/playstyle.js";

export interface PlaystyleEvidence { url: string; excerpt: string; }
export interface PlaystyleEditorialRatings { technique?: number; kumikata?: number; newaza?: number; }
export interface PlaystyleJudokaRecord {
  id: string;
  slug: string;
  firstname?: string;
  surname?: string;
  bio: string;
  signatureMoveIds: string[];
  stats?: PlaystyleEditorialRatings;
}

/** The source record is projected to a small allowlist before it reaches JEV. */
export interface PlaystyleClassificationInput {
  record: PlaystyleJudokaRecord;
  evidence: PlaystyleEvidence[];
  techniques: Technique[];
}

export interface PlaystyleFacetProposal<F extends PlaystyleFacet = PlaystyleFacet> {
  proposed: PlaystyleOption<F>;
  confidence: number;
  /** A confidence-gated suggestion; a human must still approve it before canonical use. */
  policyAccepted: ApprovedPlaystyleOption<F> | null;
}

export type PlaystyleClassification = {
  [F in PlaystyleFacet]: PlaystyleFacetProposal<F>;
};

export interface PlaystyleClassificationItem {
  judokaId: string;
  judokaSlug: string;
  classification: PlaystyleClassification;
  confidenceThreshold: number;
  requiresHumanApproval: true;
}

export interface PlaystyleClassificationResult extends PlaystyleClassificationItem {
  model: string;
  usage: Record<string, unknown>;
}

export interface PlaystyleClassifier {
  classify(input: PlaystyleClassificationInput): Promise<PlaystyleClassificationResult>;
}

export const PLAYSTYLE_QUESTION_IDS: Record<PlaystyleFacet, string> = {
  tacticalStyle: "tactical_style",
  tempo: "tempo",
  gripStyle: "grip_style",
  newazaEmphasis: "newaza_emphasis",
  standingPreference: "standing_preference",
};

export const DEFAULT_PLAYSTYLE_CONFIDENCE_THRESHOLD = 0.78;
export const MAX_PLAYSTYLE_EVIDENCE_ITEMS = 10;
export const MAX_PLAYSTYLE_REQUEST_BYTES = 64_000;
