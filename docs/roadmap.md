# Roadmap

Fases aproximadas. El orden puede cambiar cuando aprendamos algo nuevo; lo que no cambia es que cada fase termina con algo que funciona y se puede probar.

| Fase | Nombre                                        | Estado      |
| ---- | --------------------------------------------- | ----------- |
| 0    | Foundation                                    | Hecha       |
| 1    | Organizaciones, usuarios y autenticación      | Hecha       |
| 2    | Documentos y almacenamiento                   | Hecha       |
| 3    | Pipeline de ingesta                           | Siguiente   |
| 4    | Chunking y embeddings                         | Planificada |
| 5    | Recuperación vectorial y primer RAG           | Planificada |
| 6    | Citas y conversaciones                        | Planificada |
| 7    | Recuperación híbrida                          | Planificada |
| 8    | Reranking y JEV                               | Planificada |
| 9    | Permisos empresariales                        | Planificada |
| 10   | Evaluación del RAG                            | Planificada |
| 11   | Conectores                                    | Planificada |
| 12   | Endurecimiento para producción y self-hosting | Planificada |

## Fase 0 — Foundation

Una base que se puede clonar, levantar y probar.

- Monorepo con pnpm y módulos de Go.
- API en NestJS, web en Next.js y worker en Go.
- PostgreSQL con pgvector, Redis, NATS JetStream y MinIO en Docker Compose.
- Contratos compartidos con JSON Schema.
- Flujo de prueba API → NATS → worker.
- Logs estructurados, request ids, métricas, health, readiness y trazas opcionales.
- CI con lint, typecheck, tests, builds, imágenes de Docker y un smoke test end-to-end.

## Fase 1 — Organizaciones, usuarios y autenticación

Hecha. Detalle en [auth-and-tenancy.md](architecture/auth-and-tenancy.md).

- Usuarios, organizaciones y membresías en PostgreSQL, con ids UUIDv7 y migraciones SQL.
- Registro y login con email y contraseña (Argon2id), sesiones opacas en una cookie `HttpOnly`, logout que revoca la sesión y protección contra _session fixation_, CSRF y fuerza bruta.
- Roles OWNER, ADMIN, MEMBER y VIEWER, con la garantía de que una organización nunca se queda sin owner.
- Invitaciones de un solo uso con enlace, aceptables con una cuenta existente o creando una nueva.
- API keys por organización, revocables y con scopes; hoy, `system:read`.
- Aislamiento entre organizaciones en la API, con tests dedicados.
- `/api/v1/system/status` exige sesión o API key; los probes de health siguen siendo públicos; el endpoint de desarrollo no puede activarse con `APP_ENV=production`.
- Formato de errores común, documentación OpenAPI, auditoría mínima y métricas de autenticación.
- Web con registro, login, dashboard, selector de organización y ajustes de organización, miembros, invitaciones y API keys.

**Lista cuando:** una persona puede crear una organización, invitar a otra y ambas solo ven los datos de su organización. _Cumplido: lo comprueban el test de flujo completo de la API y el smoke test contra Docker Compose._

Quedó fuera, para fases posteriores: OIDC y SSO ([ADR 0009](adr/0009-local-credentials-first-oidc-later.md)), verificación de email, recuperación de contraseña, MFA, envío de invitaciones por email, Row Level Security ([ADR 0010](adr/0010-tenant-isolation-in-the-application.md)) y límites de tasa compartidos entre réplicas.

## Fase 2 — Documentos y almacenamiento

Hecha. Detalle en [documents.md](architecture/documents.md) y en el [ADR 0012](adr/0012-streaming-uploads-and-storage-consistency.md).

- Colecciones por organización, con nombres únicos sin distinguir mayúsculas, y borrado solo cuando están vacías.
- Documentos con metadatos en PostgreSQL y contenido en S3, bajo claves hechas de ids.
- Subida en streaming de punta a punta (navegador → web → API → S3), con el límite de tamaño aplicado mientras llega el archivo, SHA-256 calculado al vuelo y validación de tipo por extensión, tipo declarado y contenido.
- Descarga en streaming, siempre como attachment, con `nosniff` y CSP sandbox.
- Estados de almacenamiento separados de la futura ingesta, y una consistencia PostgreSQL ↔ S3 que se puede recuperar tras fallos.
- Scopes de API key para colecciones y documentos, limitados a la organización de la key.
- Interfaz con colecciones, subida con progreso real, detalle del documento, descarga y borrado.

**Lista cuando:** se puede subir, listar, descargar y borrar un documento dentro de una colección. _Cumplido: lo comprueban los tests de integración contra PostgreSQL y MinIO reales y el smoke test contra Docker Compose._

Quedó fuera: antivirus y OCR, permisos por colección o documento (fase 9), una tarea que reconcilie documentos atascados, subidas reanudables y URLs prefirmadas.

## Fase 3 — Pipeline de ingesta

- Eventos `document.ingestion.*` y stream `DOCUMENTS`.
- Patrón outbox para publicar eventos de forma consistente con la base de datos.
- Extracción de texto de PDF, DOCX, HTML y Markdown en el worker.
- Estado de ingesta en una columna propia, separado de `storage_status`, y visible en la interfaz, con reintentos y errores claros.

**Lista cuando:** un documento subido termina en estado _procesado_ o _fallido_ con un motivo comprensible, y reintentarlo no duplica nada.

## Fase 4 — Chunking y embeddings

- Estrategias de chunking configurables (por tamaño, por estructura del documento).
- Proveedores de embeddings intercambiables (APIs comerciales y modelos self-hosted).
- Batching, límites de tasa y reintentos.
- Tablas de fragmentos y vectores con índices HNSW.

**Lista cuando:** cada documento procesado tiene sus fragmentos y embeddings, y reindexar con otro modelo no deja datos mezclados.

## Fase 5 — Recuperación vectorial y primer RAG

- Búsqueda semántica filtrada por organización y colección.
- Primer flujo de pregunta y respuesta con un LLM.
- Proveedores de LLM intercambiables.

**Lista cuando:** se puede preguntar sobre una colección y la respuesta usa fragmentos de esa colección y de ninguna otra.

## Fase 6 — Citas y conversaciones

- Respuestas con citas a los fragmentos y documentos usados.
- Conversaciones con historial.
- Interfaz de chat.

**Lista cuando:** cada afirmación de una respuesta se puede rastrear hasta su fuente.

## Fase 7 — Recuperación híbrida

- Búsqueda vectorial y léxica combinadas.
- Fusión de resultados con Reciprocal Rank Fusion (RRF).
- Comparar el `tsvector` de PostgreSQL con alternativas como OpenSearch si los resultados no alcanzan.

**Lista cuando:** la búsqueda híbrida mejora la recuperación medida sobre un conjunto de pruebas respecto a la vectorial sola.

## Fase 8 — Reranking y JEV

- Clasificación de la evidencia recuperada.
- Reranking de candidatos.
- _Evidence gating_: no responder, o decirlo explícitamente, cuando la evidencia no alcanza.

**Lista cuando:** ante preguntas sin evidencia suficiente en los documentos, el sistema lo dice en lugar de inventar.

## Fase 9 — Permisos empresariales

- RBAC completo.
- Permisos por colección y por documento, aplicados en la propia consulta de recuperación.
- Aislamiento entre tenants verificado con tests dedicados.
- Auditoría de accesos y consultas.

**Lista cuando:** un usuario nunca recibe en una respuesta fragmentos de documentos que no puede abrir.

## Fase 10 — Evaluación del RAG

- Datasets de evaluación por colección.
- Métricas de recuperación (recall, MRR) y de respuesta (fidelidad a las fuentes).
- Latencia, uso de tokens y coste por consulta.

**Lista cuando:** cada cambio en chunking, recuperación o modelos se puede comparar con números antes de desplegarlo.

## Fase 11 — Conectores

- GitHub, Google Drive, S3, sitios web y otros.
- Sincronización incremental y respeto de los permisos de origen.

**Lista cuando:** una fuente conectada se mantiene sincronizada sin intervención manual.

## Fase 12 — Endurecimiento para producción y self-hosting

- Despliegue documentado (Kubernetes y una opción sencilla con Compose).
- NATS con autenticación, TLS y réplicas; PostgreSQL con backups probados.
- Gestión de secretos, límites, cuotas y escalado.
- Guía de operación y actualización entre versiones.

**Lista cuando:** una organización puede desplegar VeraRAG en su infraestructura siguiendo la documentación, actualizarlo y recuperarse de un fallo.
