export type RestHandlerErrorCode = "bad_request" | "forbidden" | "not_found" | "method_not_allowed" | "conflict" | "internal_error";

export type RestHandlerContext = {
  json: (body: unknown, status?: number, headers?: HeadersInit) => Response;
  failure: (status: number, code: RestHandlerErrorCode, message: string) => Response;
  namedPage: <T extends { id: string }>(name: string, records: T[], limit: number | undefined, cursor: string | undefined) => unknown;
};

export type SimpleRestHandlerContext = Pick<RestHandlerContext, "json">;
