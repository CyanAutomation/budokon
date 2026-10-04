import type { JevDecisionClient } from "./types.js";
import {
  DEFAULT_PLAYSTYLE_CONFIDENCE_THRESHOLD,
  MAX_PLAYSTYLE_REQUEST_BYTES,
  PLAYSTYLE_QUESTION_IDS,
  type PlaystyleClassificationInput,
  type PlaystyleClassifier,
  type PlaystyleClassificationResult,
} from "./playstyle-classification-contracts.js";
import {
  buildPlaystyleState,
  classifyPlaystyleAnswers,
  createPlaystyleClassificationQuestions,
  validatePlaystyleConfidenceThreshold,
  validatePlaystyleDecisionResult,
} from "./playstyle-classification-policy.js";

/** Produces confidence-gated advisory playstyle proposals; this service has no write path. */
export class PlaystyleClassificationService implements PlaystyleClassifier {
  constructor(
    private readonly client: JevDecisionClient,
    private readonly confidenceThreshold = DEFAULT_PLAYSTYLE_CONFIDENCE_THRESHOLD,
  ) {
    validatePlaystyleConfidenceThreshold(confidenceThreshold);
  }

  async classify(input: PlaystyleClassificationInput): Promise<PlaystyleClassificationResult> {
    const state = buildPlaystyleState(input);
    const questions = createPlaystyleClassificationQuestions();
    if (new TextEncoder().encode(JSON.stringify({ state, questions })).byteLength > MAX_PLAYSTYLE_REQUEST_BYTES) {
      throw new RangeError("playstyle request exceeds the 64 KB JEV request limit");
    }
    const raw = await this.client.decide(state, questions);
    const response = validatePlaystyleDecisionResult(raw, questions);
    return {
      judokaId: input.record.id,
      judokaSlug: input.record.slug,
      classification: classifyPlaystyleAnswers(response.answers, this.confidenceThreshold),
      confidenceThreshold: this.confidenceThreshold,
      requiresHumanApproval: true,
      model: response.model,
      usage: response.usage,
    };
  }
}

export { DEFAULT_PLAYSTYLE_CONFIDENCE_THRESHOLD } from "./playstyle-classification-contracts.js";
export { PLAYSTYLE_QUESTION_IDS };
