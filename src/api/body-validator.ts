/**
 * Request body validator for REST API requests.
 * Centralizes body validation logic with proper error handling.
 */

import { validateDrawBody, validateEventDrawBody } from "./schemas.js";
import type { DrawBodySchema, EventDrawBodySchema } from "./schemas.js";
import type { DrawRequest, EventDrawRequest } from "../domain/types.js";

export interface BodyValidator {
  /**
   * Validate and normalize a draw request body.
   * @param value - Raw request body
   * @returns Validated draw request
   * @throws TypeError if validation fails
   */
  validateDrawBody(value: unknown): DrawRequest;

  /**
   * Validate and normalize an event draw request body.
   * @param value - Raw request body
   * @returns Validated event draw request
   * @throws TypeError if validation fails
   */
  validateEventDrawBody(value: unknown): EventDrawRequest;
}

/**
 * Create a body validator instance.
 */
export function createBodyValidator(): BodyValidator {
  return {
    validateDrawBody(value: unknown): DrawRequest {
      return validateDrawBody(value);
    },

    validateEventDrawBody(value: unknown): EventDrawRequest {
      return validateEventDrawBody(value);
    },
  };
}
