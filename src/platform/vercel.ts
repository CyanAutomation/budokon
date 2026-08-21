/** Adapt the shared Fetch API router to Vercel's standard Request entry point. */
export function createVercelHandler(router: (request: Request) => Response | Promise<Response>) {
  return (request: Request) => router(request);
}
