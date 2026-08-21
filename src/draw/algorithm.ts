import algorithmContract from "./algorithm-contract.json" with { type: "json" };

if (algorithmContract.default !== "budokon-v1") {
  throw new Error(`unexpected default draw algorithm: ${algorithmContract.default}`);
}

/** The immutable identifier for the draw contract implemented by this package. */
export const DRAW_ALGORITHM = algorithmContract.default;

/** Draw identifiers accepted by this service, in preference order. */
export const SUPPORTED_DRAW_ALGORITHMS: readonly string[] = Object.freeze([...algorithmContract.supported]);
