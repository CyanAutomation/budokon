/**
 * Request authorization helper for internal/admin access.
 * Validates internal API key authorization on platform-specific credentials.
 */

export interface RequestAuthority {
  /**
   * Check if a request is authorized for internal access.
   * @param request - The fetch API request object
   * @returns Whether the request is authorized (false if promise rejects or authorizer not provided)
   */
  isAuthorizedInternal(request: Request): Promise<boolean>;
}

export interface AuthorizerFn {
  (request: Request): boolean | Promise<boolean>;
}

/**
 * Create a request authority instance.
 * @param authorizeFn - Optional function to check internal authorization
 */
export function createRequestAuthority(authorizeFn?: AuthorizerFn): RequestAuthority {
  return {
    async isAuthorizedInternal(request: Request): Promise<boolean> {
      try {
        return authorizeFn ? await authorizeFn(request) : false;
      } catch {
        return false;
      }
    },
  };
}
