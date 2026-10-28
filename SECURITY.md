# Security policy

## Scope

This policy covers the BU-DO-KON Worker, its public REST and MCP interfaces,
OAuth resource-server configuration, deployment workflows, and published data.

## Reporting a vulnerability

Please report suspected vulnerabilities through GitHub's private vulnerability
reporting feature for this repository when it is available. If private reporting
is unavailable, contact the repository maintainers through GitHub without
posting exploit details in a public issue or pull request.

Include the affected commit or release, the potential impact, and steps to
reproduce the issue. Remove credentials, personal data, and other sensitive
values from logs and examples before sharing them.

## Credential exposure

If a Worker secret or deployment credential may have been exposed, rotate it
through the relevant provider's secret-management interface and report the
incident privately. Do not add credential values to issues, pull requests, or
repository files.
