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

const endpoints = [
  ["GET", "/v1/judoka", "Search, filter, or page public judoka."],
  ["GET", "/v1/judoka/{id}", "Look up a judoka by UUID, slug, legacy slug, or name alias."],
  ["POST", "/v1/draw", "Draw one or more judoka, optionally with a reproducible seed."],
  ["GET", "/v1/techniques", "List techniques, optionally using cursor pagination."],
  ["GET", "/v1/techniques/{id}", "Get one technique by ID."],
  ["GET", "/v1/events", "List gameplay events for a ruleset and category."],
  ["GET", "/v1/events/{id}", "Get one gameplay event by ID."],
  ["POST", "/v1/events/draw", "Draw an event for a required ruleset."],
  ["GET", "/v1/countries", "List supported countries."],
  ["GET", "/v1/weight-categories", "List weight categories."],
  ["GET", "/v1/version", "Get catalogue and draw algorithm versions."],
  ["GET", "/v1/status", "Get service health and release identity."],
  ["GET", "/v1/coverage", "Get public representation and rarity coverage."],
] as const;

const endpointCards = endpoints.map(([method, route, summary]) => {
  const requestLink = method === "GET" && !route.includes("{")
    ? ` <a href="${route}">Open request</a>`
    : "";
  return `<article class="endpoint"><div class="route"><span class="method ${method.toLowerCase()}">${method}</span><code>${route}</code></div><p>${summary}</p>${requestLink}</article>`;
}).join("\n");

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]!);
}

function documentationPage(origin: string): string {
  const serviceOrigin = escapeHtml(origin);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="BU-DO-KON public catalogue API reference">
  <title>BU-DO-KON API reference</title>
  <style>
    :root { color-scheme: light dark; font: 16px/1.55 system-ui, sans-serif; }
    body { margin: 0 auto; padding: 2.5rem 1.25rem 4rem; max-width: 58rem; }
    header { border-bottom: 1px solid #8886; margin-bottom: 2rem; padding-bottom: 1.5rem; }
    h1, h2 { line-height: 1.2; }
    h1 { margin-bottom: .35rem; }
    a { color: #1769aa; }
    @media (prefers-color-scheme: dark) { a { color: #8fc7ff; } }
    .links { display: flex; flex-wrap: wrap; gap: .75rem 1.25rem; }
    .endpoint { border-top: 1px solid #8886; padding: 1rem 0; }
    .route { align-items: center; display: flex; flex-wrap: wrap; gap: .65rem; }
    .method { border-radius: .25rem; color: #fff; font-size: .75rem; font-weight: 700; letter-spacing: .04em; padding: .12rem .45rem; }
    .get { background: #287a48; }
    .post { background: #93620d; }
    code, pre { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
    .endpoint p { margin: .45rem 0; }
    pre { background: #8882; border-radius: .35rem; overflow-x: auto; padding: .85rem; }
    footer { border-top: 1px solid #8886; margin-top: 2rem; padding-top: 1rem; }
  </style>
</head>
<body>
  <header>
    <p>BU-DO-KON · Public REST API</p>
    <h1>BU-DO-KON API reference</h1>
    <p>Browse the catalogue with standard HTTP requests. Public reads need no credential.</p>
    <nav class="links" aria-label="API documents">
      <a href="/openapi/v1.yaml">OpenAPI contract</a>
      <a href="/">Service links</a>
    </nav>
  </header>
  <main>
    <section aria-labelledby="quick-start">
      <h2 id="quick-start">Quick start</h2>
      <p>Search judoka by name and country. Add more filters or use <code>limit</code> to page through results.</p>
      <pre><code>curl "${serviceOrigin}/v1/judoka?q=shozo&amp;countryCode=JP"</code></pre>
      <p>For reproducible draws, provide a seed and keep the returned dataset and algorithm versions.</p>
      <pre><code>curl -X POST "${serviceOrigin}/v1/draw" \\
  -H "content-type: application/json" \\
  -d '{"count":1,"seed":"round-42","filters":{"personType":"real"}}'</code></pre>
    </section>
    <section aria-labelledby="endpoints">
      <h2 id="endpoints">Endpoints</h2>
      ${endpointCards}
    </section>
    <section aria-labelledby="responses">
      <h2 id="responses">Responses and limits</h2>
      <p>Public GET responses include an <code>ETag</code>. Send it as <code>If-None-Match</code> to revalidate a cached response. On <code>429</code>, wait for <code>Retry-After</code> before retrying.</p>
      <p>Use <code>limit</code> from 1 through 100 to enable cursor pagination. Send the returned <code>nextCursor</code> with the same filters to continue.</p>
      <p>All routes, parameters, response schemas, and error cases are described in the <a href="/openapi/v1.yaml">OpenAPI contract</a>.</p>
    </section>
  </main>
  <footer><small>BU-DO-KON · Versioned catalogue data for judo games and applications.</small></footer>
</body>
</html>`;
}

/** A small first-party API guide. The OpenAPI document remains the full machine-readable contract. */
export function documentationResponse(origin: string): Response {
  return new Response(documentationPage(origin), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; connect-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    },
  });
}

export function openApiResponse(specification: string): Response {
  return new Response(specification, { headers: { "content-type": "application/yaml; charset=utf-8", "cache-control": "public, max-age=300" } });
}
