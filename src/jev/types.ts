/** Typed questions and answers accepted by the OpenRouter JEV decisions API. */
export type JevQuestion =
  | { type: "noul"; instructions: string; criteria?: { true: string; false: string } }
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "score"; instructions: string; criteria: string[] };

export type JevAnswer =
  | { type: "noul"; noul: number }
  | { type: "choice"; choice: string; probabilities: Record<string, number>; confidence: number }
  | { type: "score"; score: number; legend: Record<string, string>; probabilities: Record<string, number>; confidence: number };

export interface JevDecisionResult {
  model: string;
  answers: Record<string, JevAnswer>;
  usage: Record<string, unknown>;
}

/** Small interface so editorial services are testable and provider-independent. */
export interface JevDecisionClient {
  decide(state: unknown, questions: Record<string, JevQuestion>): Promise<JevDecisionResult>;
}
