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

The compiled `dist/manifest.json` identifies the canonical data commit used to
create that artifact. It need not equal a later application-only commit in the
repository. The production workflow recompiles artifacts with the deployment
commit, then verifies them before deploying; use the manifest’s
`sourceGitCommit` when checking a tracked release artifact locally.
