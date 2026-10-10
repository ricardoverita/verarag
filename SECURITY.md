🇬🇧 [Read this policy in English](SECURITY.en.md)

# Política de seguridad

VeraRAG está en una etapa inicial y todavía no tiene versiones publicadas. Los reportes se evalúan sobre la rama `main`.

## Cómo reportar una vulnerabilidad

**No abras un issue, una discusión ni un pull request públicos para reportar una vulnerabilidad.** Mientras no exista una corrección, publicar los detalles pone en riesgo a quien ya esté usando el proyecto.

Usa el reporte privado de vulnerabilidades de GitHub:

1. Abre la pestaña **Security** del repositorio.
2. Pulsa **Report a vulnerability**.
3. Completa el formulario. Solo el mantenedor puede verlo.

Si esa opción no aparece en el repositorio, escribe de forma privada al mantenedor a través de los medios de contacto publicados en <https://www.ricardovera.dev/#contact>. En ese primer mensaje no incluyas detalles técnicos: indica que quieres reportar un problema de seguridad y acordaremos un canal privado para compartirlos.

## Qué incluir

- Componente afectado (`web`, `api`, `worker`, `contracts`, configuración de Docker o CI) y el commit o la fecha del código que revisaste.
- Descripción del problema y su impacto: qué podría hacer un atacante.
- Pasos para reproducirlo, idealmente con una prueba de concepto mínima.
- Configuración necesaria para reproducirlo (variables de entorno, servicios activos).
- Si la conoces, una posible corrección o mitigación.
- Cómo quieres aparecer en el aviso público, o si prefieres no aparecer.

## Qué puedes esperar

VeraRAG lo mantiene una persona, así que los plazos son orientativos:

- Confirmación de que el reporte llegó, normalmente en una semana.
- Una primera evaluación de la gravedad y, si se confirma el problema, un plan de corrección.
- La fecha de publicación del aviso se acuerda contigo, normalmente cuando la corrección ya está disponible.

## Alcance

Entran en el alcance el código y la configuración de este repositorio.

No se consideran vulnerabilidades los valores pensados solo para desarrollo local, siempre que no se activen por defecto en otros entornos:

- las credenciales de ejemplo de `.env.example`;
- NATS sin autenticación ni TLS en `compose.yaml`;
- el uso de las credenciales de root de MinIO;
- el endpoint `POST /api/v1/dev/events` cuando `DEV_ENDPOINTS_ENABLED=true` (la API no arranca con esa opción y `APP_ENV=production`);
- las cookies sin `Secure` con `APP_ENV=development`;
- `/metrics` sin autenticación, publicado solo en `127.0.0.1`.

Las vulnerabilidades de dependencias de terceros se reportan a sus proyectos. Si afectan a VeraRAG de una forma particular, avísanos igualmente.

## Estado actual

Desde la fase 1 hay cuentas, sesiones, organizaciones, roles, invitaciones y API keys. Cómo funcionan está en [docs/architecture/auth-and-tenancy.md](docs/architecture/auth-and-tenancy.md). En resumen:

- Las contraseñas se guardan con Argon2id. Las sesiones, invitaciones y API keys, solo como SHA-256 de un valor aleatorio de 256 bits.
- La cookie de sesión es `HttpOnly` y `SameSite=Lax`, y en producción, `Secure` con prefijo `__Host-`.
- Las peticiones que modifican datos se rechazan si llegan desde otro origen.
- Las rutas exigen sesión salvo que estén marcadas como públicas, y toda ruta de una organización comprueba la membresía.
- Hay límites de tasa en login, registro e invitaciones, y un bloqueo por email tras 5 logins fallidos.
- Ni las contraseñas, ni los tokens, ni las keys aparecen en logs, trazas, métricas o auditoría; el smoke test lo comprueba.

Desde la fase 2, las organizaciones guardan documentos. Se tratan como contenido no confiable ([docs/architecture/documents.md](docs/architecture/documents.md)):

- El bucket es privado y solo la API lo usa; no hay URLs públicas ni prefirmadas.
- La clave de cada objeto se forma con ids y nunca con el nombre del archivo, que solo se guarda como metadato, limpio.
- El tipo se decide por la extensión, y el tipo declarado y el contenido deben coincidir con ella. El tamaño máximo se aplica mientras llega el archivo.
- Las descargas van siempre como attachment, con `nosniff` y una CSP `sandbox` sin permisos, así que un HTML subido nunca se ejecuta en VeraRAG.
- Ni el contenido de los documentos ni las credenciales de S3 aparecen en logs, métricas o auditoría.

Limitaciones conocidas, que no hace falta reportar:

- No hay verificación de email, recuperación de contraseña, MFA ni SSO.
- Los límites de tasa viven en la memoria de cada instancia de la API.
- Sin un proxy delante que sobrescriba `X-Forwarded-For`, un cliente puede elegir la IP que ve la API a través de la web, lo que debilita los límites por IP. El bloqueo por email no depende de la IP.
- La web todavía no envía una política `script-src` en su Content-Security-Policy: necesita nonces por petición, que harían dinámicas todas las páginas.
- El aislamiento entre organizaciones se aplica en la API, sin Row Level Security en PostgreSQL ([ADR 0010](docs/adr/0010-tenant-isolation-in-the-application.md)).
- Los documentos no pasan por un antivirus. La detección de tipo comprueba firmas y estructura, no que el archivo sea inocuo: un PDF malicioso con la cabecera correcta se acepta, y quien lo descargue debe tratarlo con el mismo cuidado que cualquier archivo recibido.
- Dentro de una organización, todo miembro ve y descarga todos los documentos. Los permisos por colección o documento llegan en la fase 9.
- Las descargas no se auditan todavía; solo se cuentan en las métricas.

Docker Compose publica los puertos solo en `127.0.0.1`. Antes de exponer VeraRAG a internet, pon delante un proxy con TLS que sobrescriba `X-Forwarded-For`, usa `APP_ENV=production` y credenciales propias.
