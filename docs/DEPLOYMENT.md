# Cloudflare deployment

Production deployments use the [Deploy Cloudflare Worker workflow](../.github/workflows/deploy-cloudflare.yml). It runs on pushes to `main` and can be dispatched manually from the default branch. The workflow runs validation and tests, builds and verifies the dataset, deploys the Worker, validates its configured target, and smoke-tests the public API.

## GitHub Actions environment

Create a protected GitHub environment named `production` and restrict it to the protected `main` branch. Configure:

| Name | Kind | Purpose |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | Secret | Scoped Cloudflare Workers deployment token |
| `CLOUDFLARE_ACCOUNT_ID` | Secret | Cloudflare account used for the Worker |
| `CLOUDFLARE_DEPLOYMENT_URL` | Variable | Canonical HTTPS origin with no path, such as `https://budokon.<your-subdomain>.workers.dev` |

The configured workers.dev subdomain or custom-domain route must belong to that Cloudflare account and route to the Worker named `budokon` in `wrangler.toml`. The workflow checks this before its smoke requests.

## Worker configuration

`wrangler.toml` sets `PUBLIC_ALLOWED_ORIGINS` to `*` because public catalogue reads are intended for browser clients. Set it to a comma-separated list of exact origins if browser access should be limited. REST and MCP have separate rate-limit bindings in the Wrangler configuration; see [operations](OPERATIONS.md) before changing them.

Configure credentials as Cloudflare Worker secrets. Do not commit values or put them in browser code:

- `API_KEY` — MCP access for public tools.
- `MCP_ALLOWED_HOSTNAMES` — comma-separated Worker/custom-domain hostnames accepted by the MCP endpoint.
- `INTERNAL_API_KEY` — optional distinct credential for internal REST/MCP capabilities.
- `JEV_OPENROUTER_API_KEY` — optional key for internal JEV tools.
- `MCP_OAUTH_CLIENT_SECRET` — required only when configuring OAuth.

Set OAuth issuer, endpoint, client ID, and resource values as Worker variables or secrets as appropriate. See [internal API access](INTERNAL-API.md) for the OAuth contract and credential boundaries, and [JEV assistance](JEV.md) for optional JEV settings.

The public REST API requires no credential. Never expose `API_KEY` or `INTERNAL_API_KEY` in browser code. For local development, use the repository's [local Worker quick start](../README.md#develop-locally); no production secrets are needed for its public REST example.
