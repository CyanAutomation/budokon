import type { EventDrawRequest } from "../domain/types.js";
import { assertAllowedFields, assertExcludeField, assertStringFields, requestObject } from "./body-validation.js";

export interface EventDrawBodySchema extends EventDrawRequest {}

const EVENT_DRAW_BODY_FIELDS = new Set(["ruleset", "category", "seed", "exclude"]);

/** Validate and normalize an event draw request body. */
export function validateEventDrawBody(value: unknown): EventDrawBodySchema {
  const body = requestObject(value);
  assertAllowedFields(body, EVENT_DRAW_BODY_FIELDS);

  if (typeof body.ruleset !== "string" || body.ruleset.trim() === "") {
    throw new TypeError("ruleset must be a non-empty string");
  }

  assertStringFields(body, ["category", "seed"]);
  assertExcludeField(body);

  return body as unknown as EventDrawBodySchema;
}
