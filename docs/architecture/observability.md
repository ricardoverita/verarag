# Observabilidad

Lo que hay hoy: logs estructurados, ids de correlación, métricas de Prometheus, endpoints de health y trazas distribuidas opcionales. Solo se miden cosas que existen; no hay métricas de RAG porque todavía no hay RAG.

## Logs

La API (pino) y el worker (`log/slog`) escriben una línea JSON por evento en la salida estándar, con los mismos campos base:

| Campo     | Ejemplo                      |
| --------- | ---------------------------- |
| `time`    | `2026-10-09T23:18:56.355Z`   |
| `level`   | `info`, `warn`, `error`      |
| `msg`     | `system test event received` |
| `service` | `api` o `worker`             |
| `version` | `0.1.0`                      |

Campos de correlación:

- **API:** `requestId` en cada log generado durante una petición. Se toma de la cabecera `x-request-id` si llega con un formato seguro, o se genera un UUID, y se devuelve en la respuesta.
- **Worker:** `event_id`, `event_type` y `correlation_id`, que es el `requestId` de la petición HTTP que originó el evento.
- **Ambos:** `traceId` / `trace_id` cuando hay una traza activa.

Las cabeceras HTTP y los cuerpos no se registran, porque llevan cookies de sesión, API keys y contraseñas. De cada petición solo quedan el método, la URL y el estado, y ningún token viaja en una URL: los de invitación van en el cuerpo. El smoke test comprueba que ninguna contraseña, token ni key de los que usa aparezca en los logs. Las peticiones a `/health/live`, `/health/ready` y `/metrics` no generan logs.

## Métricas

| Servicio | Métrica                                                   | Tipo      | Etiquetas                        |
| -------- | --------------------------------------------------------- | --------- | -------------------------------- |
| api      | `http_server_request_duration_seconds`                    | histogram | `method`, `route`, `status_code` |
| api      | `verarag_events_published_total`                          | counter   | `type`, `outcome`                |
| api      | `verarag_auth_login_total`                                | counter   | —                                |
| api      | `verarag_auth_login_failed_total`                         | counter   | `reason`                         |
| api      | `verarag_auth_active_sessions`                            | gauge     | —                                |
| api      | `verarag_auth_api_key_rejected_total`                     | counter   | `reason`                         |
| api      | `verarag_organizations`                                   | gauge     | —                                |
| api      | `verarag_invitations_created_total`                       | counter   | —                                |
| api      | `verarag_invitations_accepted_total`                      | counter   | `account`                        |
| api      | `verarag_api_keys_created_total`                          | counter   | —                                |
| api      | `verarag_collections`                                     | gauge     | —                                |
| api      | `verarag_documents`                                       | gauge     | `status`                         |
| api      | `verarag_document_uploads_total`                          | counter   | `result`                         |
| api      | `verarag_document_upload_bytes_total`                     | counter   | —                                |
| api      | `verarag_document_downloads_total`                        | counter   | `result`                         |
| api      | `verarag_document_deletes_total`                          | counter   | `result`                         |
| api      | `verarag_storage_operation_duration_seconds`              | histogram | `operation`, `outcome`           |
| api      | métricas por defecto de Node.js (`process_*`, `nodejs_*`) | varios    | —                                |
| worker   | `verarag_worker_events_processed_total`                   | counter   | `type`, `outcome`                |
| worker   | `verarag_worker_event_processing_duration_seconds`        | histogram | `type`                           |
| worker   | métricas por defecto de Go (`go_*`, `process_*`)          | varios    | —                                |

- `route` es el patrón de la ruta (`/api/v1/system/status`) y no la URL, para no crear una serie por cada id.
- `outcome` en el worker es `processed`, `rejected` (inválido, no se reintenta) o `failed` (se reintenta).
- `reason` de los logins fallidos es `invalid_credentials` o `too_many_attempts`; el de las API keys rechazadas, `invalid`, `revoked`, `expired` o `insufficient_scope`. `account` es `existing` o `new`.
- `status` de los documentos es `UPLOADING`, `AVAILABLE`, `FAILED` o `DELETING`. Un `UPLOADING` o `DELETING` que no baja con el tiempo señala documentos atascados que hay que revisar ([documents.md](documents.md)). Las subidas terminan `stored`, `rejected` (el archivo no era aceptable) o `failed` (falló el almacenamiento o la conexión); las descargas, `sent`, `not_available` o `storage_error`; los borrados, `deleted` o `failed`. `operation` del almacenamiento es `put`, `get`, `head` o `delete`.
- Ninguna métrica lleva como etiqueta emails, ids de usuario, organización o documento, nombres de archivo ni prefijos de keys: la cardinalidad no depende del número de clientes.
- Los gauges de sesiones activas y de organizaciones se calculan con una consulta a PostgreSQL en cada scrape.
- Los subjects sin schema se agrupan con `type="unknown"`.

## Trazas

Están desactivadas por defecto. Se activan definiendo `OTEL_EXPORTER_OTLP_ENDPOINT` y se exportan por OTLP/HTTP a cualquier backend compatible (Jaeger, Grafana Tempo, un OpenTelemetry Collector).

Spans que se generan:

| Servicio | Span                                       | Tipo     |
| -------- | ------------------------------------------ | -------- |
| api      | `POST /api/v1/dev/events`                  | server   |
| api      | una por petición HTTP                      | server   |
| api      | `s3 put`, `s3 get`, `s3 head`, `s3 delete` | client   |
| api      | `publish system.test`                      | producer |
| worker   | `process system.test`                      | consumer |

La API continúa una traza si la petición trae `traceparent` y la pasa al worker en las cabeceras del mensaje de NATS. Los spans se crean explícitamente en lugar de con instrumentación automática, que no funciona de forma fiable con módulos ES. Por eso todavía no hay spans de las consultas a PostgreSQL ni de las llamadas a S3.

Aunque las trazas estén desactivadas en el worker, este registra el `trace_id` que recibe en `traceparent`.

## Perfil `observability`

Prometheus, Grafana y Jaeger solo se levantan con el perfil:

```bash
# En .env, para enviar trazas a Jaeger:
#   OTEL_EXPORTER_OTLP_ENDPOINT=http://jaeger:4318
docker compose --profile observability up --build
```

| Herramienta | URL                    | Notas                                                                               |
| ----------- | ---------------------- | ----------------------------------------------------------------------------------- |
| Prometheus  | http://localhost:9090  | Descubre las réplicas de `api` y `worker` por DNS.                                  |
| Grafana     | http://localhost:3002  | Usuario `admin`, contraseña `GRAFANA_ADMIN_PASSWORD`. Dashboard _VeraRAG overview_. |
| Jaeger      | http://localhost:16686 | Trazas en memoria; se pierden al reiniciar.                                         |

La configuración está en [`deployments/docker`](../../deployments/docker).

## Lo que falta

- Métricas de NATS (requiere `prometheus-nats-exporter`), de PostgreSQL y de Redis.
- Alertas.
- Agregación de logs. Hoy se leen con `docker compose logs`.
- Métricas de RAG (latencia de recuperación, tokens, coste, calidad), que llegarán con las fases 5 y 10.
