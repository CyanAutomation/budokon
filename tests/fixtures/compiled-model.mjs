import judoka from "../../dist/judoka.json" with { type: "json" };
import techniques from "../../dist/techniques.json" with { type: "json" };
import countries from "../../data/reference/countries.json" with { type: "json" };
import weightCategories from "../../data/reference/weight-categories.json" with { type: "json" };
import manifest from "../../dist/manifest.json" with { type: "json" };

/** A bundled-style compiled fixture: constructing the core performs no I/O. */
export default { judoka, techniques, countries, weightCategories, manifest };
