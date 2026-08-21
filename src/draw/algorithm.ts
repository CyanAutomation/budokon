import algorithmContract from "./algorithm-contract.json" with { type: "json" };

/** The immutable identifier for the draw contract implemented by this package. */
export const DRAW_ALGORITHM: string = algorithmContract.default;

/** Draw identifiers accepted by this service, in preference order. */
export const SUPPORTED_DRAW_ALGORITHMS: readonly string[] = Object.freeze([...algorithmContract.supported]);
