import { readFile } from "node:fs/promises";
import { validateOpenApiYaml } from "./openapi-validation.js";

const specification = await readFile(new URL("../openapi/v1.yaml", import.meta.url), "utf8");
validateOpenApiYaml(specification);
