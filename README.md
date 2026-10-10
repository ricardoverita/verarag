🇬🇧 [Read this documentation in English](README.en.md)

# VeraRAG

[![CI](https://github.com/ricardoverita/verarag/actions/workflows/ci.yml/badge.svg)](https://github.com/ricardoverita/verarag/actions/workflows/ci.yml)

VeraRAG es una plataforma open source de conocimiento y recuperación empresarial diseñada para construir sistemas RAG seguros, explicables y observables.

> **Estado:** VeraRAG está en una etapa inicial. La arquitectura base, las cuentas, las organizaciones, las API keys, las colecciones y la subida de documentos funcionan, pero todavía no es una plataforma RAG de producción. Hoy los documentos se guardan, pero no se procesan: no hay ingesta, búsqueda ni chat.

## Qué es VeraRAG

VeraRAG no pretende ser "un chatbot para PDFs". Es una plataforma sobre la que una organización puede construir su propia base de conocimiento privada: conectar documentos y fuentes internas, buscar en ellos y hacer preguntas, sabiendo de dónde sale cada respuesta y quién puede ver qué.

El recorrido que seguirá una pregunta:

```
Fuentes → Documentos → Ingesta → Chunking → Embeddings → Recuperación
        → Reranking / Evidencia → LLM → Respuesta + fuentes
```

Ninguna de esas etapas existe todavía. Cada una tiene su fase en el [roadmap](#roadmap).

## El problema

Buena parte del conocimiento de una empresa vive repartido en documentos, wikis, repositorios y carpetas compartidas. Añadirle un LLM encima es fácil; hacerlo bien no tanto:

- **Permisos.** Una respuesta no puede usar documentos que la persona que pregunta no tiene permiso para leer.
- **Aislamiento.** Los datos de una organización no pueden mezclarse con los de otra.
- **Trazabilidad.** Cada respuesta tiene que poder justificarse con sus fuentes, y saber decir "no lo sé" cuando la evidencia no alcanza.
- **Observabilidad y evaluación.** Hace falta medir qué se recupera, cuánto tarda, cuánto cuesta y si las respuestas son fieles a las fuentes.
- **Control.** Muchas organizaciones necesitan ejecutarlo en su propia infraestructura y elegir sus proveedores de LLM y de embeddings.

VeraRAG intenta resolver esas cosas desde el diseño, no como parches posteriores.

## Estado actual

La fase 0 dejó una base ejecutable, la fase 1 añadió las organizaciones y el acceso, y la fase 2 los documentos:

- **Cuentas y sesiones.** Registro y login con email y contraseña (Argon2id), sesiones en una cookie `HttpOnly` que se pueden revocar, y protección contra CSRF, _session fixation_ y fuerza bruta.
- **Organizaciones.** Cada persona puede pertenecer a varias, con roles OWNER, ADMIN, MEMBER y VIEWER. Una organización nunca se queda sin owner, y nadie ve datos de una organización a la que no pertenece.
- **Invitaciones** de un solo uso por enlace, y **API keys** por organización con scopes.
- **Colecciones y documentos.** PDF, DOCX, Markdown, texto y HTML se suben en streaming hasta el almacenamiento S3, con el límite de tamaño aplicado mientras llega el archivo, SHA-256 calculado al vuelo y el tipo comprobado por extensión y contenido. Se descargan siempre como archivo, nunca se muestran en el navegador, y se borran sin perder la trazabilidad.
- **API** en NestJS con validación y formato de errores comunes, documentación OpenAPI en desarrollo, auditoría, health, readiness, métricas, estado detallado del sistema y un endpoint de desarrollo que publica un evento de prueba.
- **Worker** en Go que consume ese evento desde NATS JetStream, lo valida contra su contrato y lo registra en un log estructurado. Publica un heartbeat para que la API sepa que está vivo.
- **Web** en Next.js con registro, login, dashboard, selector de organización, colecciones y documentos (subida con progreso real), y ajustes de organización, miembros, invitaciones y API keys.
- **Contratos** en JSON Schema compartidos por TypeScript y Go.
- **PostgreSQL con pgvector**, **NATS JetStream**, **MinIO** y **Redis** en Docker Compose.
- Logs estructurados, request ids, métricas de Prometheus y trazas distribuidas opcionales.
- CI con lint, typecheck, tests unitarios y de integración contra PostgreSQL y MinIO reales, builds, imágenes de Docker y un smoke test end-to-end.

Lo que **no** existe todavía: extracción de texto e ingesta, embeddings, búsqueda, RAG, conectores, antivirus, SSO, verificación de email ni recuperación de contraseña. Redis está provisionado, pero ningún servicio lo usa aún.

## Arquitectura

```mermaid
flowchart LR
    browser([Navegador]) --> web["web<br/>Next.js"]
    web -- "HTTP, también /api/v1" --> api["api<br/>NestJS"]
    api --> postgres[("PostgreSQL<br/>+ pgvector")]
    api --> storage[("MinIO / S3")]
    api -- eventos --> nats{{"NATS JetStream"}}
    nats --> worker["worker<br/>Go"]
    worker -- heartbeat --> nats
```

- El navegador solo habla con la **web**, que reenvía `/api/v1` a la API desde su servidor. La cookie de sesión pertenece al origen de la web y no hace falta CORS.
- La **API** es el control plane: es dueña de las cuentas, las sesiones, las organizaciones y sus permisos, y lo será de los metadatos y de la orquestación de las consultas.
- El **worker** es el data plane: procesará documentos, fragmentos y embeddings.
- La API y el worker nunca se llaman directamente. Se comunican por NATS JetStream con payloads definidos en `packages/contracts`.
- **PostgreSQL** es la fuente de verdad y guardará los vectores junto a sus metadatos, para que los permisos se apliquen en la misma consulta.

Más detalle en [docs/architecture](docs/architecture/overview.md), en [autenticación y organizaciones](docs/architecture/auth-and-tenancy.md) y en los [ADR](docs/adr/README.md). Las variables de entorno de cada servicio están en [docs/configuration.md](docs/configuration.md).

## Stack

| Pieza               | Tecnología                                                        |
| ------------------- | ----------------------------------------------------------------- |
| Web                 | Next.js 16, React 19, TypeScript                                  |
| API / control plane | NestJS 12, Node.js 24, TypeScript                                 |
| Worker / data plane | Go 1.27                                                           |
| Mensajería          | NATS 2.15 con JetStream                                           |
| Base de datos       | PostgreSQL 18 + pgvector 0.8.7                                    |
| Migraciones         | dbmate (SQL plano)                                                |
| Autenticación       | Argon2id, sesiones opacas en PostgreSQL                           |
| Documentación API   | OpenAPI 3 generado desde los esquemas Zod                         |
| Almacenamiento      | API de S3 con subidas multipart en streaming; MinIO en desarrollo |
| Caché (futuro)      | Redis 8                                                           |
| Contratos           | JSON Schema 2020-12                                               |
| Observabilidad      | pino, slog, Prometheus, Grafana, OpenTelemetry, Jaeger            |
| Tests               | Vitest, Supertest, Testcontainers, `go test`                      |
| Monorepo            | pnpm workspaces + módulos de Go                                   |

## Quick start

Necesitas Docker con Compose v2. Con todo en marcha, los contenedores usan unos 300 MB de memoria; la primera build necesita bastante más, sobre todo la de la web.

```bash
git clone https://github.com/ricardoverita/verarag.git
cd verarag
cp .env.example .env
docker compose up --build
```

La primera build tarda unos minutos. Cuando todo esté arriba:

| Servicio                | URL                                |
| ----------------------- | ---------------------------------- |
| Web                     | http://localhost:3000              |
| Documentación de la API | http://localhost:3001/api/docs     |
| Readiness de la API     | http://localhost:3001/health/ready |
| Consola de MinIO        | http://localhost:9001              |
| Monitor de NATS         | http://localhost:8222              |

### Primeros pasos

1. Abre http://localhost:3000 y pulsa **Create an account**. Se crea también tu primera organización, donde eres owner.
2. El dashboard muestra la organización y el estado de cada componente: API, Database, Messaging, Worker y Object storage deberían aparecer como _Healthy_.
3. En **Members**, invita a otra persona: obtienes un enlace que se muestra una sola vez. Ábrelo en otra ventana privada para crear la segunda cuenta.
4. En **Collections**, crea una colección y sube un documento arrastrándolo o eligiéndolo. Su página muestra el tipo, el tamaño, el SHA-256 y quién lo subió, y permite descargarlo y borrarlo.
5. En **API keys**, crea una key y pruébala:

```bash
curl -H "Authorization: Bearer $VERARAG_API_KEY" http://localhost:3000/api/v1/system/status
```

Con los scopes `documents:read` o `documents:write`, la misma key lee o sube documentos ([detalle](docs/architecture/documents.md)).

Si abres la web con otra dirección, por ejemplo `http://127.0.0.1:3000`, define `WEB_PUBLIC_URL` en `.env` para que los enlaces de invitación apunten a ella.

### Probar el flujo de eventos

```bash
curl -X POST http://localhost:3001/api/v1/dev/events \
  -H 'Content-Type: application/json' \
  -d '{"type": "system.test", "message": "hello from VeraRAG"}'

docker compose logs worker
```

La API publica el evento en NATS JetStream y el worker lo consume y escribe una línea como esta:

```json
{
  "level": "info",
  "msg": "system test event received",
  "event_id": "…",
  "correlation_id": "…",
  "message": "hello from VeraRAG"
}
```

`./scripts/smoke-test.sh` hace todas estas comprobaciones de una vez.

El endpoint `/api/v1/dev/events` es solo para desarrollo: existe porque `.env.example` define `DEV_ENDPOINTS_ENABLED=true`.

### Observabilidad

```bash
docker compose --profile observability up --build
```

Añade Prometheus (http://localhost:9090), Grafana (http://localhost:3002, usuario `admin`) y Jaeger (http://localhost:16686). Para ver trazas, define `OTEL_EXPORTER_OTLP_ENDPOINT=http://jaeger:4318` en `.env`. Detalles en [docs/architecture/observability.md](docs/architecture/observability.md).

### Si un puerto está ocupado

Todos los puertos se publican solo en `127.0.0.1` y se pueden cambiar en `.env` (`WEB_PORT`, `API_PORT`, `POSTGRES_PORT`, etc.).

## Comandos de desarrollo

```bash
pnpm install          # dependencias; también compila packages/contracts
pnpm lint             # ESLint
pnpm format           # Prettier
pnpm typecheck        # TypeScript en todos los paquetes
pnpm test             # tests de contracts, api y web; los de integración necesitan Docker
pnpm build            # build de contracts, api y web

cd apps/worker && go vet ./... && go test -race ./...
cd packages/contracts && go test ./...

./scripts/smoke-test.sh   # end-to-end contra el entorno de Docker
```

Para trabajar con recarga en caliente (infraestructura en Docker y la app en tu máquina), mira [CONTRIBUTING.md](CONTRIBUTING.md).

## Estructura del repositorio

```
apps/
  api/            API y control plane (NestJS); migraciones en db/migrations
  web/            interfaz (Next.js)
  worker/         data plane (Go)
packages/
  contracts/      JSON Schemas compartidos, con tipos y validadores para TS y Go
deployments/
  docker/         configuración de Prometheus y Grafana
docs/
  adr/            decisiones de arquitectura
  architecture/   visión general, API, autenticación, documentos, mensajería y observabilidad
  configuration.md
  roadmap.md
scripts/
  smoke-test.sh   prueba end-to-end del entorno local
compose.yaml      entorno local con Docker Compose
```

## Roadmap

| Fase | Contenido                                                                                                                            |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 0    | **Foundation**: monorepo, Docker, API, web, worker, NATS, PostgreSQL, pgvector, Redis, MinIO, observabilidad base y CI. _Hecha._     |
| 1    | **Organizaciones, usuarios y autenticación**: cuentas, sesiones, roles, invitaciones, API keys y aislamiento entre tenants. _Hecha._ |
| 2    | **Documentos y almacenamiento**: colecciones, subida y descarga en streaming, checksums, estados recuperables. _Hecha._              |
| 3    | Pipeline de ingesta. _Siguiente._                                                                                                    |
| 4    | Chunking y embeddings                                                                                                                |
| 5    | Recuperación vectorial y primer RAG                                                                                                  |
| 6    | Citas y conversaciones                                                                                                               |
| 7    | Recuperación híbrida: búsqueda vectorial, léxica y RRF                                                                               |
| 8    | Reranking y JEV: clasificación de evidencia, reranking y evidence gating                                                             |
| 9    | Permisos empresariales: RBAC, colecciones, permisos por documento y aislamiento entre tenants                                        |
| 10   | Evaluación del RAG: datasets, métricas de recuperación, fidelidad, latencia, tokens y coste                                          |
| 11   | Conectores: GitHub, Google Drive, S3, sitios web y otros                                                                             |
| 12   | Endurecimiento para producción y self-hosting                                                                                        |

El detalle de cada fase, con lo que la da por terminada, está en [docs/roadmap.md](docs/roadmap.md).

## Seguridad

- Si encuentras una vulnerabilidad, **no abras un issue público**: sigue [SECURITY.md](SECURITY.md).
- Las rutas exigen sesión o API key salvo las públicas (registro, login, invitaciones y health). Los documentos subidos se tratan como contenido no confiable: el bucket es privado, las claves de objeto no contienen nombres de archivo y las descargas van siempre como attachment, con `nosniff` y CSP sandbox. Las contraseñas se guardan con Argon2id, y los tokens y keys solo como hash. El estado actual y las limitaciones conocidas están en [SECURITY.md](SECURITY.md#estado-actual).
- Compose publica los puertos solo en `127.0.0.1`. No expongas este entorno a internet sin un proxy con TLS delante y `APP_ENV=production`.
- Los valores de `.env.example` y la configuración de `compose.yaml` son para desarrollo local: credenciales de ejemplo, NATS sin autenticación y el endpoint de desarrollo activado.
- `.env` está en `.gitignore`. No subas secretos reales.
- La API y el worker validan su configuración al arrancar y se detienen con un mensaje claro si falta algo.
- La API aplica cabeceras de seguridad y limita el tamaño de los cuerpos JSON y la frecuencia de peticiones, con límites más estrictos en login, registro e invitaciones. Las imágenes de la API, la web y el worker se ejecutan sin root.
- CI ejecuta `pnpm audit` sobre las dependencias de producción y `govulncheck` sobre el código Go, y Dependabot propone actualizaciones cada semana.

## Contribuir

Las contribuciones son bienvenidas. Lee [CONTRIBUTING.md](CONTRIBUTING.md) para levantar el entorno, el estilo de código y cómo proponer cambios. Este proyecto sigue un [código de conducta](CODE_OF_CONDUCT.md).

## Licencia

VeraRAG se distribuye bajo la [Apache License 2.0](LICENSE).

En resumen, permite usar el código con fines comerciales, modificarlo, distribuirlo y usarlo de forma privada, e incluye una concesión explícita de patentes por parte de quienes contribuyen. A cambio, hay que conservar los avisos de copyright y de licencia (incluido el archivo [NOTICE](NOTICE)) e indicar los cambios en los archivos modificados. No concede derechos sobre marcas y se ofrece sin garantías.

Este resumen no sustituye al texto de la licencia.

## Autor

VeraRAG fue iniciado por **Ricardo Vera**, Software Engineer / Solutions Architect.

- GitHub: [https://github.com/ricardoverita](https://github.com/ricardoverita)
- Web: [https://www.ricardovera.dev](https://www.ricardovera.dev)
