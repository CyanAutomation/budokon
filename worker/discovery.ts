/** Public entry points intentionally reveal only documentation and release metadata routes. */
export function landingResponse(origin: string): Response {
  return new Response(JSON.stringify({
    name: "BU-DO-KON public catalogue API",
    documentation: `${origin}/docs`,
    openapi: `${origin}/openapi/v1.yaml`,
    status: `${origin}/v1/status`,
    version: `${origin}/v1/version`
  }), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=300" } });
}

const swaggerUiDocument = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>BU-DO-KON API reference</title><link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui.css"></head>
<body><main id="swagger-ui" aria-label="BU-DO-KON API reference"></main>
<script src="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui-bundle.js"></script>
<script>window.ui = SwaggerUIBundle({url:"/openapi/v1.yaml",dom_id:"#swagger-ui",deepLinking:true,presets:[SwaggerUIBundle.presets.apis],layout:"BaseLayout"});</script>
</body></html>`;

/** Interactive API reference backed by the canonical OpenAPI document. */
export function documentationResponse(): Response {
  return new Response(swaggerUiDocument, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; script-src 'self' 'unsafe-inline' https://unpkg.com; style-src 'self' 'unsafe-inline' https://unpkg.com; img-src 'self' data: https:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    },
  });
}

export function openApiResponse(specification: string): Response {
  return new Response(specification, { headers: { "content-type": "application/yaml; charset=utf-8", "cache-control": "public, max-age=300" } });
}
