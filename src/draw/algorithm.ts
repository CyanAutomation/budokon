import algorithmContract from "./algorithm-contract.json" with { type: "json" };

function assertBudokonV1(value: string): "budokon-v1" {
  if (value !== "budokon-v1") {
    throw new Error(`unexpected default draw algorithm: ${value}`);
  }
  return value;
}

/** The immutable identifier for the draw contract implemented by this package. */
export const DRAW_ALGORITHM = assertBudokonV1(algorithmContract.default);

/** Draw identifiers accepted by this service, in preference order. */
export const SUPPORTED_DRAW_ALGORITHMS: readonly string[] = Object.freeze([...algorithmContract.supported]);
