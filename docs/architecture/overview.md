# Arquitectura

Este documento describe lo que existe hoy y hacia dónde va. Lo que todavía no está implementado aparece marcado como _planificado_.

## Componentes

```mermaid
flowchart LR
    browser([Navegador]) -- "páginas y /api/v1" --> web["web<br/>Next.js"]
    program([Integración]) -. "API key" .-> web
    web -- "HTTP (desde el servidor)" --> api["api<br/>NestJS"]
    api --> postgres[("PostgreSQL<br/>+ pgvector")]
    api --> storage[("MinIO / S3")]
    api -- "publica eventos" --> nats{{"NATS JetStream"}}
    nats -- "consumidor durable" --> worker["worker<br/>Go"]
    worker -- "heartbeat (KV)" --> nats
    redis[("Redis<br/>sin uso todavía")]
```

| Componente     | Tecnología               | Hoy                                                                                                                                                                | Planificado                                                                 |
| -------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| `web`          | Next.js 16, React 19     | Registro, login, dashboard, ajustes de organización, miembros, invitaciones y API keys, y el estado de cada componente. Reenvía `/api/v1` a la API.                | Gestión de documentos y colecciones, chat con fuentes, administración.      |
| `api`          | NestJS 12, Node.js 24    | Cuentas, sesiones, organizaciones, roles, invitaciones, API keys, auditoría, health, métricas, estado del sistema, OpenAPI y un endpoint de desarrollo de eventos. | Permisos por documento, documentos, conversaciones, RAG.                    |
| `worker`       | Go 1.27                  | Consume `system.test`, publica su heartbeat, expone health y métricas.                                                                                             | Extracción, normalización, chunking, embeddings, indexación y reindexación. |
| PostgreSQL     | PostgreSQL 18 + pgvector | Fuente de verdad: usuarios, organizaciones, membresías, sesiones, invitaciones, API keys y auditoría.                                                              | Documentos, fragmentos y vectores.                                          |
| NATS JetStream | NATS 2.15                | Stream `SYSTEM` y bucket `worker-heartbeats`.                                                                                                                      | Stream `DOCUMENTS` con los eventos de ingesta.                              |
| Object storage | MinIO (local), API de S3 | La API comprueba que el bucket existe.                                                                                                                             | Documentos originales.                                                      |
| Redis          | Redis 8                  | Se levanta con Docker Compose, pero ningún servicio lo usa.                                                                                                        | Caché, rate limiting compartido, sesiones y locks.                          |

La web nunca habla con la base de datos ni con NATS: solo llama a la API, y lo hace desde su servidor. El navegador tampoco llama a la API: la web reenvía `/api/v1/*` desde su servidor, de modo que la cookie de sesión pertenece al origen de la web y no hace falta CORS. La API y el worker no se llaman entre sí: solo se comunican por NATS, con los contratos de [`packages/contracts`](../../packages/contracts).

Cómo funcionan las cuentas, las sesiones, las organizaciones y las API keys está en [auth-and-tenancy.md](auth-and-tenancy.md). Las convenciones HTTP (versiones, validación, formato de errores y OpenAPI), en [api.md](api.md).

## Flujos actuales

### Estado del sistema

```mermaid
sequenceDiagram
    participant B as Navegador
    participant W as web
    participant A as api
    participant P as PostgreSQL
    participant N as NATS
    participant S as MinIO
    B->>W: GET /dashboard
    W-->>B: HTML estático + panel en streaming
    W->>A: GET /api/v1/system/status (con la cookie de sesión)
    par comprobaciones en paralelo (2 s máx. cada una)
        A->>P: versión de la extensión vector
        A->>N: información de JetStream
        A->>N: heartbeats en worker-heartbeats
        A->>S: HeadBucket
    end
    A-->>W: estado por componente
    W-->>B: API, Database, Messaging, Worker, Object storage
```

La API guarda el resultado durante 2 segundos, así que varias pestañas abiertas no multiplican las consultas a la infraestructura. El estado detallado exige una sesión o una API key con `system:read`. Sin ellas, la página de inicio solo muestra que la API responde, y se refresca cada 10 segundos.

El worker se considera sano si hay al menos una entrada en el bucket `worker-heartbeats`. Cada instancia escribe la suya cada 10 segundos mientras puede consumir eventos, las entradas caducan a los 30 segundos y el worker borra la suya al apagarse.

### Evento de prueba

```mermaid
sequenceDiagram
    participant C as curl / smoke test
    participant A as api
    participant N as NATS JetStream
    participant K as worker
    C->>A: POST /api/v1/dev/events
    A->>A: valida contra system.test.schema.json
    A->>N: publish system.test (Nats-Msg-Id, traceparent)
    N-->>A: ack (stream SYSTEM, secuencia)
    A-->>C: 202 Accepted {id, stream, sequence}
    N->>K: entrega (consumidor worker-system)
    K->>K: valida contra el mismo schema
    K->>K: log "system test event received"
    K->>N: ack
```

El endpoint solo existe con `DEV_ENDPOINTS_ENABLED=true`. Sirve para comprobar que la arquitectura funciona de punta a punta y no forma parte del producto.

## Quién es dueño de qué

- **Esquema de la base de datos:** la API. Las migraciones están en `apps/api/db/migrations` y se aplican con dbmate antes de que arranque la API.
- **Streams de NATS:** la API los crea o actualiza al arrancar. El worker espera a que existan.
- **Consumidores durables:** cada worker define el suyo.
- **Bucket de heartbeats:** el worker lo crea; la API solo lo lee.
- **Contratos:** `packages/contracts`, compartido por ambos lenguajes.

## Endpoints operativos

| Servicio | Endpoint                    | Uso                                                   |
| -------- | --------------------------- | ----------------------------------------------------- |
| web      | `GET /health/live`          | Liveness. No comprueba la API.                        |
| api      | `GET /health/live`          | Liveness. No comprueba dependencias.                  |
| api      | `GET /health/ready`         | Readiness: PostgreSQL y NATS responden. 503 si no.    |
| api      | `GET /metrics`              | Métricas de Prometheus.                               |
| api      | `GET /api/v1/system/status` | Estado detallado. Sesión o API key con `system:read`. |
| worker   | `GET /health/live`          | Liveness (puerto 8081, solo en la red interna).       |
| worker   | `GET /health/ready`         | Conectado a NATS y consumiendo eventos.               |
| worker   | `GET /metrics`              | Métricas de Prometheus.                               |

Los probes de health son públicos y no revelan versiones ni detalles. `/metrics` no tiene autenticación y no debería exponerse públicamente en un despliegue real: en Compose solo se publica en `127.0.0.1`, y la web no lo reenvía.

## Lo que todavía no está

- **SSO, verificación de email, recuperación de contraseña y MFA.** Hoy solo hay cuentas con email y contraseña ([ADR 0009](../adr/0009-local-credentials-first-oidc-later.md)).
- **Permisos por colección y por documento, y Row Level Security.** El aislamiento entre organizaciones se aplica en la API ([ADR 0010](../adr/0010-tenant-isolation-in-the-application.md)); los permisos finos llegan en la fase 9.
- **Outbox.** Cuando la API escriba en la base de datos y publique eventos en la misma operación, hará falta para no perder eventos (fase 3).
- **NATS en producción.** El entorno local no usa autenticación, TLS ni réplicas.
- **Redis.** Está provisionado pero ningún servicio lo usa. Los límites de tasa viven en la memoria de la API y pasarán a Redis cuando haya varias réplicas.

## Hacia dónde va (planificado)

**Ingesta:** la web sube un documento → la API lo guarda en el almacenamiento de objetos y registra sus metadatos → publica `document.ingestion.requested` → el worker extrae el texto, lo divide en fragmentos, calcula embeddings y los guarda en PostgreSQL → publica `document.ingestion.completed` o `document.ingestion.failed` → la API actualiza el estado del documento.

**Consulta:** la persona pregunta → la API recupera fragmentos con búsqueda vectorial y léxica filtrada por permisos → los reordena y descarta evidencia insuficiente → llama al LLM → devuelve la respuesta con sus fuentes y registra la consulta para auditoría y evaluación.

El orden y el alcance de cada paso están en el [roadmap](../roadmap.md).
