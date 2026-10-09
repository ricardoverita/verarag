# Configuración

Los servicios se configuran con variables de entorno. La API y el worker validan su configuración al arrancar: si falta algo o un valor no es válido, se detienen con un mensaje que lista todos los problemas.

Con Docker Compose solo se edita `.env` (a partir de [`.env.example`](../.env.example)); `compose.yaml` construye con esos valores las variables de cada servicio.

## API (`apps/api`)

| Variable                      | Por defecto             | Descripción                                                                                |
| ----------------------------- | ----------------------- | ------------------------------------------------------------------------------------------ |
| `DATABASE_URL`                | obligatoria             | URL `postgres://` de PostgreSQL. En local, con `?sslmode=disable`.                         |
| `DATABASE_POOL_MAX`           | `10`                    | Conexiones máximas del pool.                                                               |
| `NATS_URL`                    | `nats://localhost:4222` | Servidor de NATS, o varios separados por comas.                                            |
| `S3_BUCKET`                   | obligatoria             | Bucket de documentos. La API no lo crea.                                                   |
| `S3_ENDPOINT`                 | vacío                   | Endpoint compatible con S3 (MinIO, R2...). Vacío significa AWS S3.                         |
| `S3_REGION`                   | `us-east-1`             | Región de S3.                                                                              |
| `S3_ACCESS_KEY_ID`            | vacío                   | Credenciales. Las dos o ninguna; sin ellas se usa la cadena de credenciales de AWS.        |
| `S3_SECRET_ACCESS_KEY`        | vacío                   |                                                                                            |
| `S3_FORCE_PATH_STYLE`         | `false`                 | `true` para MinIO y otros servidores que no usan subdominios por bucket.                   |
| `API_HOST`                    | `0.0.0.0`               | Interfaz en la que escucha. Fuera de un contenedor, mejor `127.0.0.1`.                     |
| `API_PORT`                    | `3001`                  | Puerto HTTP.                                                                               |
| `LOG_LEVEL`                   | `info`                  | `fatal`, `error`, `warn`, `info`, `debug`, `trace` o `silent`.                             |
| `DEV_ENDPOINTS_ENABLED`       | `false`                 | Monta `POST /api/v1/dev/events`. Solo para desarrollo local y CI.                          |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | vacío                   | Activa las trazas y las envía por OTLP/HTTP a esta URL (por ejemplo `http://jaeger:4318`). |

## Worker (`apps/worker`)

| Variable                      | Por defecto             | Descripción                                                                                   |
| ----------------------------- | ----------------------- | --------------------------------------------------------------------------------------------- |
| `NATS_URL`                    | `nats://localhost:4222` | Servidor de NATS (`nats://` o `tls://`).                                                      |
| `WORKER_HTTP_ADDR`            | `:8081`                 | Dirección del servidor de health y métricas.                                                  |
| `WORKER_INSTANCE_ID`          | hostname                | Id de la instancia en los logs y en el bucket de heartbeats.                                  |
| `WORKER_SHUTDOWN_TIMEOUT`     | `15s`                   | Tiempo máximo para terminar los eventos en curso al apagarse.                                 |
| `LOG_LEVEL`                   | `info`                  | `debug`, `info`, `warn` o `error`.                                                            |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | vacío                   | Activa las trazas. El exportador también acepta el resto de variables `OTEL_EXPORTER_OTLP_*`. |

## Web (`apps/web`)

| Variable           | Por defecto             | Descripción                                                            |
| ------------------ | ----------------------- | ---------------------------------------------------------------------- |
| `API_INTERNAL_URL` | `http://localhost:3001` | URL de la API. Solo la usa el servidor de Next.js, nunca el navegador. |
| `PORT`             | `3000`                  | Puerto del servidor.                                                   |
| `HOSTNAME`         | `0.0.0.0` en Docker     | Interfaz en la que escucha el servidor standalone.                     |

## Docker Compose (`.env`)

Además de las credenciales de PostgreSQL, Redis, MinIO y Grafana, `.env` define los puertos que se publican en `127.0.0.1`. Los valores por defecto y su descripción están comentados en [`.env.example`](../.env.example).

`LOG_LEVEL` se comparte entre la API y el worker, así que en Compose conviene usar uno de los niveles que entienden ambos: `debug`, `info`, `warn` o `error`.
