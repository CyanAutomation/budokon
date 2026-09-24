# BU-DO-KON operations

The Cloudflare Worker enables Observability in `wrangler.toml`. After the first
production deployment, create a dashboard and alerts for the public Worker.

Monitor:

* availability and server-error rate (`5xx`);
* request latency, including p95 and p99;
* `429` responses by route, to tune the public limiter; and
* deployment identity from `/v1/status` (`datasetVersion`, source commit, and
  checksum), so a rollout serves the intended release.

Alert on sustained non-zero `5xx`, on a latency threshold appropriate for game
traffic, and on a material rise in `429` responses. Route alerts to the team’s
on-call channel and include the endpoint, Cloudflare colo, deployment ID, and
release identity.

Every main-branch deployment runs a public smoke test. It verifies release
metadata, discovery/OpenAPI, cache revalidation, pagination, validation errors,
CORS preflight, and deterministic judoka and event draws. If it fails, treat
the deployment as unhealthy and investigate before relying on the new release.

## Rate-limit binding separation

The Worker intentionally routes authenticated `/mcp` traffic through the
`MCP_RATE_LIMITER` Cloudflare binding and public REST traffic through
`PUBLIC_RATE_LIMITER`. Keep these as distinct bindings when changing or cloning
an environment: they have independent policies and prevent public catalogue
traffic from consuming the MCP quota (or MCP clients from consuming the public
quota). Monitor and tune `429` rates for each binding separately.

The compiled `dist/manifest.json` identifies the canonical data commit used to
create that artifact. It need not equal a later application-only commit in the
repository. The production workflow recompiles artifacts with the deployment
commit, then verifies them before deploying; use the manifest’s
`sourceGitCommit` when checking a tracked release artifact locally.

## Application releases

The manually dispatched **Release** workflow publishes an application release
from the default branch. It analyzes commits after the latest `vMAJOR.MINOR.PATCH`
tag; existing `vMAJOR.MINOR` tags are read as patch version zero. A `feat`
creates a minor release, `fix`, `perf`, and `revert` create a patch release,
and a `!` marker or `BREAKING CHANGE:` footer creates a major release.
Documentation and maintenance commits alone do not create a release.

Choose the dry-run option to preview the version and release notes without
calling the GitHub API. Locally, `npm run release:dry` prints the same preview.
The publishing run uses the workflow token to create a GitHub Release and tag
for the commit checked out by that workflow.
