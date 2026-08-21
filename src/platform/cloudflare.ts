/** Cloudflare's module-worker shape, kept separate from the shared REST router. */
export function createCloudflareWorker(router: (request: Request) => Response | Promise<Response>) {
  return { fetch(request: Request) { return router(request); } };
}
