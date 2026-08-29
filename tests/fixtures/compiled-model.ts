import aggregate from "../../dist/budokon.json" with { type: "json" };
import manifest from "../../dist/manifest.json" with { type: "json" };

/** A bundled-style compiled fixture: constructing the core performs no I/O. */
export default { ...aggregate, manifest };
