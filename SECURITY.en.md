🇪🇸 [Leer esta política en español](SECURITY.md)

# Security policy

VeraRAG is at an early stage and has no published releases yet. Reports are assessed against the `main` branch.

## How to report a vulnerability

**Do not open a public issue, discussion or pull request to report a vulnerability.** Until a fix exists, publishing the details puts anyone already using the project at risk.

Use GitHub's private vulnerability reporting:

1. Open the repository's **Security** tab.
2. Click **Report a vulnerability**.
3. Fill in the form. Only the maintainer can see it.

If that option does not show up in the repository, contact the maintainer privately through the contact details published at <https://www.ricardovera.dev/#contact>. Do not include technical details in that first message: say that you want to report a security issue and we will agree on a private channel to share them.

## What to include

- Affected component (`web`, `api`, `worker`, `contracts`, Docker configuration or CI) and the commit or date of the code you reviewed.
- A description of the problem and its impact: what an attacker could do.
- Steps to reproduce it, ideally with a minimal proof of concept.
- The configuration needed to reproduce it (environment variables, running services).
- A possible fix or mitigation, if you have one in mind.
- How you would like to be credited in the public advisory, or whether you prefer not to be.

## What to expect

VeraRAG is maintained by one person, so these timelines are approximate:

- Confirmation that the report arrived, usually within a week.
- A first assessment of the severity and, if the problem is confirmed, a plan to fix it.
- The advisory's publication date is agreed with you, usually once the fix is available.

## Scope

The code and configuration in this repository are in scope.

Values meant only for local development are not considered vulnerabilities, as long as they are not enabled by default elsewhere:

- the example credentials in `.env.example`;
- NATS without authentication or TLS in `compose.yaml`;
- using the MinIO root credentials;
- the `POST /api/v1/dev/events` endpoint when `DEV_ENDPOINTS_ENABLED=true`.

Vulnerabilities in third-party dependencies should be reported to those projects. If they affect VeraRAG in a particular way, let us know as well.

## Current state

There is no authentication yet (it arrives in phase 1 of the [roadmap](docs/roadmap.md)): every endpoint is public. Docker Compose only publishes ports on `127.0.0.1`. Do not expose this environment to the internet.
