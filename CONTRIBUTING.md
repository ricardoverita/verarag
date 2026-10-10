🇬🇧 [Read this guide in English](CONTRIBUTING.en.md)

# Contribuir a VeraRAG

Gracias por tu interés. Las contribuciones externas son bienvenidas: código, documentación, pruebas, reportes de errores o simplemente preguntas que dejen claro qué no se entiende.

VeraRAG está en una etapa temprana y muchas decisiones todavía se están tomando. Para cambios grandes, abre primero un issue y lo hablamos; así nadie invierte días en algo que luego no encaja.

## Requisitos

Para ejecutar el proyecto basta con **Docker** (Engine 24 o superior, con Compose v2).

Para desarrollar:

- **Node.js 24** (está en `.nvmrc`; con nvm, `nvm use`).
- **pnpm 11**. La versión exacta está en `packageManager` de `package.json`; con `corepack enable` se instala sola.
- **Go 1.27**.

## Levantar el proyecto

```bash
cp .env.example .env
docker compose up --build
```

Con todo arriba, `./scripts/smoke-test.sh` comprueba el estado de cada componente, el flujo de autenticación completo a través de la web (registro, login, invitación, miembros y API keys), el aislamiento entre organizaciones, que ningún secreto llegue a los logs y el flujo API → NATS → worker.

### Desarrollar con recarga en caliente

Deja la infraestructura en Docker y ejecuta en tu máquina la aplicación en la que trabajas:

```bash
docker compose up -d postgres nats minio minio-init migrate
pnpm install
```

Si tenías el entorno completo levantado, detén antes los contenedores que vas a reemplazar: `docker compose stop api worker web`.

API (con recarga en caliente):

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

Web (usa `http://localhost:3001` como API por defecto):

```bash
pnpm --filter @verarag/web dev
```

Los valores salen de `.env.example`; si cambiaste tu `.env`, ajústalos. Todas las variables están descritas en [docs/configuration.md](docs/configuration.md). Los servidores de desarrollo usan la versión compilada de `packages/contracts`: si los cambias mientras trabajas, ejecuta `pnpm contracts`. `pnpm lint`, `pnpm typecheck` y `pnpm test` ya lo hacen por su cuenta.

## Comandos

Desde la raíz:

| Comando          | Qué hace                                                                               |
| ---------------- | -------------------------------------------------------------------------------------- |
| `pnpm lint`      | ESLint en todo el código TypeScript                                                    |
| `pnpm format`    | Formatea con Prettier (`format:check` solo revisa)                                     |
| `pnpm typecheck` | `tsc` en cada paquete                                                                  |
| `pnpm test`      | Tests de contracts, api y web (Vitest). Los de integración de la API necesitan Docker. |
| `pnpm build`     | Compila contracts, api y web                                                           |
| `pnpm contracts` | Compila solo `packages/contracts`                                                      |

En cada módulo de Go (`apps/worker`, `packages/contracts`):

```bash
gofmt -l .
go vet ./...
go test -race ./...
```

## Ramas y commits

- Crea tu rama desde `main` con un prefijo que indique el tipo de cambio: `feat/`, `fix/`, `docs/`, `refactor/`, `test/`, `ci/` o `chore/`. Por ejemplo, `feat/document-upload`.
- Usamos [Conventional Commits](https://www.conventionalcommits.org/es/). En este repositorio el asunto suele ir en español y el cuerpo incluye también la versión en inglés:

  ```
  fix(worker): reintenta el heartbeat si el bucket desaparece

  Retry the heartbeat when the bucket disappears.
  ```

  Si no te sientes cómodo escribiendo en español, escribe en inglés. Lo importante es que el mensaje describa el cambio real.

- Prefiere commits pequeños y coherentes a uno gigante, y evita mezclar refactors con cambios de comportamiento.

## Estilo

- **TypeScript:** modo estricto, sin `any`, formateado con Prettier. Las reglas de ESLint corren en CI.
- **Go:** `gofmt`, `go vet`, errores explícitos con contexto (`fmt.Errorf("...: %w", err)`) y `context.Context` en todo lo que haga I/O.
- Los comentarios explican el porqué, no lo que el código ya dice.
- Nada de abstracciones "por si acaso": una interfaz, una capa o un patrón entran cuando hay un segundo caso que los justifica.
- Si un cambio modifica una decisión de arquitectura, añade un ADR en `docs/adr`.

## Tests

- Todo cambio de comportamiento viene con tests.
- La API tiene dos proyectos de Vitest. `unit` usa dobles en memoria de PostgreSQL, NATS y S3 (`apps/api/test/support`) y no necesita Docker. `integration` levanta PostgreSQL con pgvector y MinIO mediante Testcontainers (las mismas imágenes que Docker Compose), aplica las migraciones y prueba los flujos por HTTP contra una base de datos y un almacenamiento S3 reales; necesita Docker. Cada archivo de tests usa su propia base de datos y su propio bucket. Para ejecutar solo los primeros: `pnpm --filter @verarag/api exec vitest run --project unit`.
- Todo recurso nuevo que pertenezca a una organización amplía los tests de aislamiento entre organizaciones (`apps/api/test/integration/tenant-isolation.spec.ts` y los de cada recurso).
- El worker prueba su consumidor contra un servidor NATS embebido en el propio test (`internal/natstest`).
- Si cambias un contrato, actualiza el schema, el ejemplo y los tipos de **ambos** lenguajes, y ejecuta los tests de los dos. El [README de los contratos](packages/contracts/README.md) explica los pasos.
- Para cambios que cruzan servicios, ejecuta también `./scripts/smoke-test.sh` con el entorno levantado.

## Pull requests

1. Asegúrate de que `pnpm lint`, `pnpm typecheck`, `pnpm test` y los tests de Go pasan en local.
2. Describe qué cambia, por qué y cómo lo probaste. La plantilla del pull request te guía.
3. Mantén el pull request enfocado en un solo tema. Es más fácil de revisar y de revertir.
4. La CI tiene que pasar. Si algo falla y no sabes por qué, pregunta en el propio pull request.

## Reportar errores

Abre un issue con la plantilla _Reporte de error_ e incluye cómo reproducirlo, qué esperabas, qué pasó y los logs relevantes (`docker compose logs <servicio>`). Revisa que no contengan secretos.

Los problemas de seguridad **no** se reportan en issues públicos: sigue [SECURITY.md](SECURITY.md).

## Proponer funcionalidades

Abre un issue con la plantilla _Propuesta_ y empieza por el problema, no por la solución: qué necesitas hacer y por qué no se puede hoy. Mira antes el [roadmap](docs/roadmap.md); quizá ya está planificado y puedes aportar en esa fase.

## Código de conducta

Este proyecto sigue el [Código de Conducta](CODE_OF_CONDUCT.md). Al participar, aceptas respetarlo.

## Licencia

Al contribuir aceptas que tu contribución se publique bajo la [Apache License 2.0](LICENSE), la misma licencia del proyecto, tal como establece su sección 5. No hace falta firmar ningún acuerdo adicional.
