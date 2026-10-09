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
- el endpoint `POST /api/v1/dev/events` cuando `DEV_ENDPOINTS_ENABLED=true`.

Las vulnerabilidades de dependencias de terceros se reportan a sus proyectos. Si afectan a VeraRAG de una forma particular, avísanos igualmente.

## Estado actual

Todavía no hay autenticación (llega en la fase 1 del [roadmap](docs/roadmap.md)): todos los endpoints son públicos. Docker Compose publica los puertos solo en `127.0.0.1`. No expongas este entorno a internet.
