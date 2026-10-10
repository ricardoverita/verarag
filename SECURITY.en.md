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
- the `POST /api/v1/dev/events` endpoint when `DEV_ENDPOINTS_ENABLED=true` (the API refuses to start with that option and `APP_ENV=production`);
- cookies without `Secure` with `APP_ENV=development`;
- `/metrics` without authentication, published only on `127.0.0.1`.

Vulnerabilities in third-party dependencies should be reported to those projects. If they affect VeraRAG in a particular way, let us know as well.

## Current state

Since phase 1 there are accounts, sessions, organizations, roles, invitations and API keys. How they work is described in [docs/architecture/auth-and-tenancy.md](docs/architecture/auth-and-tenancy.md) (in Spanish). In short:

- Passwords are stored with Argon2id. Sessions, invitations and API keys are stored only as the SHA-256 of a 256-bit random value.
- The session cookie is `HttpOnly` and `SameSite=Lax`, and in production `Secure` with the `__Host-` prefix.
- Requests that change data are refused when they come from another origin.
- Routes require a session unless they are marked public, and every organization route checks the membership.
- Sign-in, sign-up and invitations are rate limited, and an email is locked after 5 failed sign-ins.
- Passwords, tokens and keys never reach logs, traces, metrics or the audit trail; the smoke test checks it.

Since phase 2, organizations store documents. They are treated as untrusted content ([docs/architecture/documents.md](docs/architecture/documents.md), in Spanish):

- The bucket is private and only the API uses it; there are no public or presigned URLs.
- Each object's key is made of ids, never of the file name, which is only kept, cleaned, as metadata.
- The extension picks the type, and the declared type and the content must match it. The maximum size is enforced while the file arrives.
- Downloads are always attachments, with `nosniff` and a `sandbox` CSP that allows nothing, so uploaded HTML never runs in VeraRAG.
- Neither document content nor S3 credentials reach logs, metrics or the audit trail.

Known limitations, which do not need to be reported:

- There is no email verification, password reset, MFA or SSO.
- Rate limits live in the memory of each API instance.
- Without a proxy in front that overwrites `X-Forwarded-For`, a client can choose the IP the API sees through the web app, which weakens the per-IP limits. The per-email lock does not depend on the IP.
- The web app does not send a `script-src` Content-Security-Policy yet: it needs per-request nonces, which would make every page dynamic.
- Tenant isolation is enforced in the API, without Row Level Security in PostgreSQL ([ADR 0010](docs/adr/0010-tenant-isolation-in-the-application.md)).
- Documents are not scanned for malware. Type detection checks signatures and structure, not that a file is harmless: a malicious PDF with the right header is accepted, and whoever downloads it should treat it as any received file.
- Within an organization, every member sees and downloads every document. Per-collection and per-document permissions arrive in phase 9.
- Downloads are not audited yet; they are only counted in the metrics.

Docker Compose only publishes ports on `127.0.0.1`. Before exposing VeraRAG to the internet, put a TLS proxy in front that overwrites `X-Forwarded-For`, use `APP_ENV=production` and your own credentials.
