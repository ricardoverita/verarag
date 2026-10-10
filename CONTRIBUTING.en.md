🇪🇸 [Leer esta guía en español](CONTRIBUTING.md)

# Contributing to VeraRAG

Thanks for your interest. Outside contributions are welcome: code, documentation, tests, bug reports, or just questions that point out what is not clear.

VeraRAG is at an early stage and many decisions are still being made. For large changes, open an issue first so we can talk about it; that way nobody spends days on something that does not fit.

The main language of the project is Spanish, and most technical documentation (ADRs, architecture) is only in Spanish for now. Issues and pull requests in English are perfectly fine.

## Requirements

To run the project you only need **Docker** (Engine 24 or newer, with Compose v2).

To develop:

- **Node.js 24** (pinned in `.nvmrc`; with nvm, run `nvm use`).
- **pnpm 11**. The exact version is in the `packageManager` field of `package.json`; `corepack enable` installs it for you.
- **Go 1.27**.

## Running the project

```bash
cp .env.example .env
docker compose up --build
```

Once everything is up, `./scripts/smoke-test.sh` checks every component, the whole authentication flow through the web app (sign-up, sign-in, invitation, members and API keys), tenant isolation, that no secret reaches the logs, and the API → NATS → worker flow.

### Developing with hot reload

Keep the infrastructure in Docker and run the app you are working on directly on your machine:

```bash
docker compose up -d postgres nats minio minio-init migrate
pnpm install
```

If the full environment was running, first stop the containers you are replacing: `docker compose stop api worker web`.

API (with hot reload):

```bash
export DATABASE_URL='postgres://verarag:local-postgres-password@localhost:5432/verarag?sslmode=disable'
export NATS_URL='nats://localhost:4222'
export S3_ENDPOINT='http://localhost:9000' S3_BUCKET='verarag-documents' S3_FORCE_PATH_STYLE='true'
export S3_ACCESS_KEY_ID='verarag' S3_SECRET_ACCESS_KEY='local-minio-password'
export APP_ENV='development' DEV_ENDPOINTS_ENABLED='true' API_HOST='127.0.0.1'
export WEB_PUBLIC_URL='http://localhost:3000'
pnpm --filter @verarag/api dev
```

Worker:

```bash
cd apps/worker
NATS_URL='nats://localhost:4222' WORKER_HTTP_ADDR='127.0.0.1:8081' go run ./cmd/worker
```

Web (uses `http://localhost:3001` as the API by default):

```bash
pnpm --filter @verarag/web dev
```

The values come from `.env.example`; adjust them if you changed your `.env`. Every variable is described in [docs/configuration.md](docs/configuration.md) (in Spanish). The development servers use the compiled version of `packages/contracts`: if you change it while working, run `pnpm contracts`. `pnpm lint`, `pnpm typecheck` and `pnpm test` already do it on their own.

## Commands

From the repository root:

| Command          | What it does                                                                  |
| ---------------- | ----------------------------------------------------------------------------- |
| `pnpm lint`      | ESLint on all TypeScript code                                                 |
| `pnpm format`    | Formats with Prettier (`format:check` only checks)                            |
| `pnpm typecheck` | `tsc` in every package                                                        |
| `pnpm test`      | contracts, api and web tests (Vitest). The API integration tests need Docker. |
| `pnpm build`     | Builds contracts, api and web                                                 |
| `pnpm contracts` | Builds only `packages/contracts`                                              |

In each Go module (`apps/worker`, `packages/contracts`):

```bash
gofmt -l .
go vet ./...
go test -race ./...
```

## Branches and commits

- Branch off `main` with a prefix that says what kind of change it is: `feat/`, `fix/`, `docs/`, `refactor/`, `test/`, `ci/` or `chore/`. For example, `feat/document-upload`.
- We use [Conventional Commits](https://www.conventionalcommits.org/). In this repository the subject is usually written in Spanish and the body includes the English version:

  ```
  fix(worker): reintenta el heartbeat si el bucket desaparece

  Retry the heartbeat when the bucket disappears.
  ```

  If you are not comfortable writing in Spanish, write in English. What matters is that the message describes the actual change.

- Prefer small, coherent commits over one huge commit, and avoid mixing refactors with behavior changes.

## Style

- **TypeScript:** strict mode, no `any`, formatted with Prettier. ESLint runs in CI.
- **Go:** `gofmt`, `go vet`, explicit errors with context (`fmt.Errorf("...: %w", err)`) and `context.Context` on everything that does I/O.
- Comments explain why, not what the code already says.
- No "just in case" abstractions: an interface, a layer or a pattern comes in when a second use case justifies it.
- If a change alters an architecture decision, add an ADR under `docs/adr`.

## Tests

- Every behavior change comes with tests.
- The API has two Vitest projects. `unit` uses in-memory doubles for PostgreSQL, NATS and S3 (`apps/api/test/support`) and does not need Docker. `integration` starts PostgreSQL with pgvector through Testcontainers, applies the migrations and tests the flows over HTTP against a real database; it needs Docker. To run only the former: `pnpm --filter @verarag/api exec vitest run --project unit`.
- Every new resource that belongs to an organization extends the tenant isolation tests (`apps/api/test/integration/tenant-isolation.spec.ts` and the ones for each resource).
- The worker tests its consumer against a NATS server embedded in the test itself (`internal/natstest`).
- If you change a contract, update the schema, the example and the types in **both** languages, and run both test suites. The [contracts README](packages/contracts/README.md) lists the steps.
- For changes that cross services, also run `./scripts/smoke-test.sh` against the running environment.

## Pull requests

1. Make sure `pnpm lint`, `pnpm typecheck`, `pnpm test` and the Go tests pass locally.
2. Describe what changes, why, and how you tested it. The pull request template guides you.
3. Keep the pull request focused on one topic. It is easier to review and to revert.
4. CI has to pass. If something fails and you do not know why, ask in the pull request.

## Reporting bugs

Open an issue with the _Bug report_ template and include how to reproduce it, what you expected, what happened and the relevant logs (`docker compose logs <service>`). Check that they contain no secrets.

Security problems are **not** reported in public issues: follow [SECURITY.en.md](SECURITY.en.md).

## Proposing features

Open an issue with the _Proposal_ template and start with the problem, not the solution: what you need to do and why it is not possible today. Check the [roadmap](docs/roadmap.md) first; it may already be planned and you can help in that phase.

## Code of conduct

This project follows the [Code of Conduct](CODE_OF_CONDUCT.en.md). By taking part, you agree to respect it.

## License

By contributing, you agree that your contribution is published under the [Apache License 2.0](LICENSE), the project's license, as stated in its section 5. No additional agreement is needed.
