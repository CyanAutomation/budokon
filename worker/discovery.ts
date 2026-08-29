const html = (value: string): string => String(value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);

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

export function documentationResponse(origin: string): Response {
  const base = html(origin);
const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>BU-DO-KON API</title><style>body{font:16px system-ui,sans-serif;line-height:1.5;max-width:46rem;margin:4rem auto;padding:0 1.5rem;color:#18212b}code{background:#f1f3f5;padding:.15rem .3rem;border-radius:.2rem}a{color:#075ab5}</style></head><body><h1>🥋 BU-DO-KON API</h1><p>A public, versioned judoka catalogue for games and applications.</p><ul><li><a href="${base}/openapi/v1.yaml">OpenAPI v1 contract</a></li><li><a href="${base}/v1/status">Live service status and release identity</a></li><li><a href="${base}/v1/version">Dataset and service versions</a></li><li><a href="${base}/v1/coverage">Catalogue coverage metrics</a></li><li><a href="${base}/v1/judoka">Browse public judoka</a></li></ul><h2>Quick start</h2><pre><code>GET ${base}/v1/judoka?q=shozo\nPOST ${base}/v1/draw\nContent-Type: application/json\n\n{"count": 1, "seed": "round-42"}</code></pre><p>The MCP endpoint is intentionally API-key protected. Browser games should use the public REST endpoints.</p></body></html>`;
  return new Response(body, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" } });
}

export function openApiResponse(specification: string): Response {
  return new Response(specification, { headers: { "content-type": "application/yaml; charset=utf-8", "cache-control": "public, max-age=300" } });
}
