# Roadmap

Fases aproximadas. El orden puede cambiar cuando aprendamos algo nuevo; lo que no cambia es que cada fase termina con algo que funciona y se puede probar.

| Fase | Nombre                                        | Estado      |
| ---- | --------------------------------------------- | ----------- |
| 0    | Foundation                                    | Hecha       |
| 1    | Organizaciones, usuarios y autenticación      | Siguiente   |
| 2    | Documentos y almacenamiento                   | Planificada |
| 3    | Pipeline de ingesta                           | Planificada |
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

- Modelo de organizaciones (tenants), usuarios y membresías.
- Inicio de sesión y sesiones. Probablemente OIDC para empresas y email con enlace o contraseña para empezar.
- Roles básicos por organización.
- API keys para integraciones.
- Proteger `/api/v1/system/status` y quitar los endpoints de desarrollo de cualquier entorno compartido.

**Lista cuando:** una persona puede crear una organización, invitar a otra y ambas solo ven los datos de su organización.

## Fase 2 — Documentos y almacenamiento

- Subida de documentos al almacenamiento de objetos a través de la API de S3.
- Metadatos de documentos y colecciones en PostgreSQL.
- Límites de tamaño, tipos permitidos y checksums.

**Lista cuando:** se puede subir, listar, descargar y borrar un documento dentro de una colección.

## Fase 3 — Pipeline de ingesta

- Eventos `document.ingestion.*` y stream `DOCUMENTS`.
- Patrón outbox para publicar eventos de forma consistente con la base de datos.
- Extracción de texto de PDF, DOCX, HTML y Markdown en el worker.
- Estado de ingesta visible en la interfaz, con reintentos y errores claros.

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
