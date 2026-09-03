import openApiSpecification from "../openapi/v1.yaml" with { type: "text" };
import { createWorker } from "./router.js";

export { createWorker } from "./router.js";
export default createWorker(openApiSpecification);
