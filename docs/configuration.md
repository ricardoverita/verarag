# Configuración

Los servicios se configuran con variables de entorno. La API y el worker validan su configuración al arrancar: si falta algo o un valor no es válido, se detienen con un mensaje que lista todos los problemas.

Con Docker Compose solo se edita `.env` (a partir de [`.env.example`](../.env.example)); `compose.yaml` construye con esos valores las variables de cada servicio.

## API (`apps/api`)

| Variable                      | Por defecto             | Descripción                                                                                                                                          |
| ----------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `APP_ENV`                     | `production`            | `development`, `test` o `production`. Sin valor, se aplican las reglas de producción.                                                                |
| `DATABASE_URL`                | obligatoria             | URL `postgres://` de PostgreSQL. En local, con `?sslmode=disable`.                                                                                   |
| `DATABASE_POOL_MAX`           | `10`                    | Conexiones máximas del pool.                                                                                                                         |
| `NATS_URL`                    | `nats://localhost:4222` | Servidor de NATS, o varios separados por comas.                                                                                                      |
| `S3_BUCKET`                   | obligatoria             | Bucket de documentos. La API no lo crea.                                                                                                             |
| `S3_ENDPOINT`                 | vacío                   | Endpoint compatible con S3 (MinIO, R2...). Vacío significa AWS S3.                                                                                   |
| `S3_REGION`                   | `us-east-1`             | Región de S3.                                                                                                                                        |
| `S3_ACCESS_KEY_ID`            | vacío                   | Credenciales. Las dos o ninguna; sin ellas se usa la cadena de credenciales de AWS.                                                                  |
| `S3_SECRET_ACCESS_KEY`        | vacío                   |                                                                                                                                                      |
| `S3_FORCE_PATH_STYLE`         | `false`                 | `true` para MinIO y otros servidores que no usan subdominios por bucket.                                                                             |
| `API_HOST`                    | `0.0.0.0`               | Interfaz en la que escucha. Fuera de un contenedor, mejor `127.0.0.1`.                                                                               |
| `API_PORT`                    | `3001`                  | Puerto HTTP.                                                                                                                                         |
| `LOG_LEVEL`                   | `info`                  | `fatal`, `error`, `warn`, `info`, `debug`, `trace` o `silent`.                                                                                       |
| `DEV_ENDPOINTS_ENABLED`       | `false`                 | Monta `POST /api/v1/dev/events`. Solo para desarrollo local y CI. Con `APP_ENV=production` la API no arranca si vale `true`.                         |
| `WEB_PUBLIC_URL`              | `http://localhost:3000` | URL pública de la web: único origen aceptado en los POST, PATCH y DELETE del navegador, y base de los enlaces de invitación.                         |
| `TRUST_PROXY`                 | `false`                 | Proxies de los que se acepta `X-Forwarded-For` para conocer la IP del cliente: `true`, un número de saltos o una lista como `loopback, uniquelocal`. |
| `SESSION_TTL_HOURS`           | `168`                   | Duración de una sesión, en horas (máximo 720).                                                                                                       |
| `SESSION_COOKIE_SECURE`       | según `APP_ENV`         | Cookie `Secure` con prefijo `__Host-`. En producción siempre es `true`; `false` solo se acepta fuera de producción.                                  |
| `DOCUMENT_MAX_SIZE_BYTES`     | `26214400` (25 MiB)     | Tamaño máximo de un documento. Se aplica mientras llega el archivo; un valor mayor no aumenta la memoria por subida, pero sí lo que tarda cada una.  |
| `INVITATION_TTL_HOURS`        | `168`                   | Validez de una invitación, en horas (máximo 720).                                                                                                    |
| `OPENAPI_ENABLED`             | según `APP_ENV`         | Sirve `/api/docs`. Activa por defecto fuera de producción y apagada en producción.                                                                   |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | vacío                   | Activa las trazas y las envía por OTLP/HTTP a esta URL (por ejemplo `http://jaeger:4318`).                                                           |

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

| Variable           | Por defecto             | Descripción                                                                                                   |
| ------------------ | ----------------------- | ------------------------------------------------------------------------------------------------------------- |
| `API_INTERNAL_URL` | `http://localhost:3001` | URL de la API. Solo la usa el servidor de Next.js, también para reenviar `/api/v1`; el navegador nunca la ve. |
| `PORT`             | `3000`                  | Puerto del servidor.                                                                                          |
| `HOSTNAME`         | `0.0.0.0` en Docker     | Interfaz en la que escucha el servidor standalone.                                                            |

## Docker Compose (`.env`)

Además de las credenciales de PostgreSQL, Redis, MinIO y Grafana, `.env` define los puertos que se publican en `127.0.0.1`. Los valores por defecto y su descripción están comentados en [`.env.example`](../.env.example).

Para la API, Compose deriva algunos valores:

- `APP_ENV` es `production` si `.env` no lo define. `.env.example` lo pone en `development`, que permite cookies sin `Secure` sobre `http://localhost`.
- `WEB_PUBLIC_URL` es `http://localhost:${WEB_PORT}` si está vacío. Si abres la web con otra dirección (por ejemplo `http://127.0.0.1:3000`), ponla aquí para que los enlaces de invitación apunten a ella.
- `TRUST_PROXY` es `loopback, uniquelocal`: la API confía en el `X-Forwarded-For` de la web, que le llega por la red privada de Docker.

`LOG_LEVEL` se comparte entre la API y el worker, así que en Compose conviene usar uno de los niveles que entienden ambos: `debug`, `info`, `warn` o `error`.
