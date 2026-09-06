import type { DrawRequest } from "../../domain/types.js";
import type { RestDrawDependency } from "../router.js";
import { validateDrawBody } from "../schemas.js";

type ErrorCode = "bad_request" | "forbidden" | "not_found" | "method_not_allowed" | "conflict" | "internal_error";

type Context = {
  json: (body: unknown, status?: number, headers?: HeadersInit) => Response;
  failure: (status: number, code: ErrorCode, message: string) => Response;
};

export async function drawHandler(
  context: Context,
  request: Request,
  draw: RestDrawDependency,
  authorizedInternal: boolean,
): Promise<Response> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) {
    throw new TypeError("content-type must be application/json");
  }
  let body: DrawRequest;
  try {
    body = validateDrawBody(await request.json());
  } catch (error) {
    if (error instanceof SyntaxError) throw new TypeError("request body contains malformed JSON");
    throw error;
  }
  if (body.includeHidden && !authorizedInternal) {
    return context.failure(403, "forbidden", "hidden records require internal authorization");
  }
  try {
    return context.json(draw.draw(body, { authorizedInternal }));
  } catch (error) {
    if (error instanceof RangeError && /exceeds eligible pool size/.test(error.message)) {
      return context.failure(409, "conflict", "requested count exceeds the eligible pool");
    }
    throw error;
  }
}
