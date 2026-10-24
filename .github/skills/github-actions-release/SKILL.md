---
name: github-actions-release
description: Use when editing or reviewing GitHub Actions workflows, CI security, application or dataset releases, or Cloudflare deployment procedures in this repository.
---

# GitHub Actions and releases

Read the relevant workflow and its runbook before changing automation:

- [Deployment guide](../../../docs/DEPLOYMENT.md)
- [Operations guide](../../../docs/OPERATIONS.md)
- [Deployment workflow](../../../.github/workflows/deploy-cloudflare.yml)
- [Application release workflow](../../../.github/workflows/release.yaml)
- [Dataset release workflow](../../../.github/workflows/dataset-release.yml)

## Workflow changes

- Pin third-party actions to full commit SHAs and keep the release tag in a
  comment for human review.
- Grant the smallest permissions needed at workflow and job level. Keep
  checkout credentials disabled unless a step explicitly needs Git access.
- Preserve protected-main and production-environment checks, concurrency
  controls, job timeouts, and artifact verification boundaries.
- Keep workflow npm commands aligned with package.json scripts. Run
  **npm run check:deployment-workflow** and **npm test** after workflow edits.
- Do not put secrets in workflow literals, logs, artifacts, or browser code.

## Release and deployment

- Application releases are manually dispatched from the protected default
  branch. Use **npm run release:dry** to review the planned version and notes.
- Dataset releases are tag-driven. Check the dataset tag, source commit,
  validation, and artifact verification path before changing that workflow.
- Cloudflare deployment runs from protected main and uses the protected
  production environment. Its build validates data, builds and checks artifacts,
  and smoke-tests the deployed API.
- Do not publish a release or trigger a production deployment as a side effect
  of code changes. Do so only when the user explicitly asks for that operation.
- After a deployment, verify the configured target and the deployed commit
  through the workflow's validation and smoke checks.
