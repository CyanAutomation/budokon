import algorithmContract from "./algorithm-contract.json" with { type: "json" };

const drawAlgorithm = algorithmContract.default;

if (drawAlgorithm !== "budokon-v1") {
  throw new Error(`unexpected default draw algorithm: ${drawAlgorithm}`);
}

/** The immutable identifier for the draw contract implemented by this package. */
export const DRAW_ALGORITHM = drawAlgorithm as "budokon-v1";

/** Draw identifiers accepted by this service, in preference order. */
export const SUPPORTED_DRAW_ALGORITHMS: readonly string[] = Object.freeze([...algorithmContract.supported]);
