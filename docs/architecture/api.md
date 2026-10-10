# API HTTP

Convenciones de la API del control plane.

## Rutas y versiones

- Las rutas del producto viven bajo `/api/v1`. La versión va en la URL.
- Las rutas operativas están fuera de ese prefijo y no se versionan: `/health/live`, `/health/ready` y `/metrics`.
- Con `OPENAPI_ENABLED`, la documentación interactiva está en `/api/docs` y el documento OpenAPI 3 en `/api/docs/openapi.json`. Por defecto está activa en desarrollo y apagada en producción.
- El navegador no llama a la API directamente: la web reenvía `/api/v1/*` desde su servidor ([auth-and-tenancy.md](auth-and-tenancy.md)). `/api/docs`, `/metrics` y `/health/*` no se pueden alcanzar a través de la web.

## Validación y respuestas

- Los cuerpos JSON se validan con esquemas Zod declarados en `@Body({ schema })`. Lo que no cumple el esquema no llega al controlador.
- Las respuestas declaran su esquema con `@ResponseSchema(schema, status)`. El serializador global las valida y descarta cualquier campo que el esquema no liste, así que una columna nueva en una consulta (un hash, un token) no puede filtrarse por accidente.
- Esos mismos esquemas generan el documento OpenAPI. La documentación no puede desviarse de lo que se valida y se envía.
- Un cuerpo JSON admite como mucho 16 KB. Las subidas de documentos son `multipart/form-data`, no pasan por ese límite y se procesan en streaming ([documents.md](documents.md)). Todas las respuestas llevan `Cache-Control: no-store` y las cabeceras de seguridad de helmet.

## Errores

Todos los errores tienen la misma forma:

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "The request is not valid.",
    "requestId": "8a3f…",
    "details": [{ "path": "password", "message": "Use at least 12 characters." }]
  }
}
```

- `code` es estable y es lo que deben mirar los clientes. `message` está pensado para personas y puede cambiar.
- `requestId` coincide con la cabecera `x-request-id` y con el campo `requestId` de los logs.
- `details` solo aparece en errores de validación, con un elemento por campo.
- Los errores inesperados devuelven `500 INTERNAL_ERROR` con un mensaje genérico. La traza y el mensaje del driver van al log, nunca a la respuesta.

| Código                      | HTTP | Cuándo                                                                     |
| --------------------------- | ---- | -------------------------------------------------------------------------- |
| `VALIDATION_FAILED`         | 400  | El cuerpo, un parámetro o el JSON no son válidos.                          |
| `INVALID_UPLOAD`            | 400  | La subida no trae exactamente un archivo en la parte `file`, o está vacío. |
| `AUTHENTICATION_REQUIRED`   | 401  | La ruta necesita una sesión y no hay.                                      |
| `INVALID_SESSION`           | 401  | La sesión no existe, fue revocada o el usuario está desactivado.           |
| `SESSION_EXPIRED`           | 401  | La sesión venció.                                                          |
| `INVALID_CREDENTIALS`       | 401  | Email o contraseña incorrectos, sin decir cuál de los dos.                 |
| `INVALID_API_KEY`           | 401  | La API key no existe, está mal formada o fue alterada.                     |
| `API_KEY_REVOKED`           | 401  | La API key fue revocada.                                                   |
| `API_KEY_EXPIRED`           | 401  | La API key venció.                                                         |
| `FORBIDDEN_ORIGIN`          | 403  | Un POST, PATCH o DELETE llegó desde otro origen.                           |
| `INSUFFICIENT_ROLE`         | 403  | El rol en la organización no permite la acción.                            |
| `INSUFFICIENT_SCOPE`        | 403  | La API key no puede usar esta ruta.                                        |
| `INVITATION_EMAIL_MISMATCH` | 403  | La invitación es para otro email.                                          |
| `NOT_FOUND`                 | 404  | La ruta no existe.                                                         |
| `ORGANIZATION_NOT_FOUND`    | 404  | La organización no existe o quien pregunta no es miembro.                  |
| `MEMBER_NOT_FOUND`          | 404  | La membresía no existe en esa organización.                                |
| `INVITATION_NOT_FOUND`      | 404  | El enlace de invitación no existe.                                         |
| `API_KEY_NOT_FOUND`         | 404  | La API key no existe en esa organización.                                  |
| `COLLECTION_NOT_FOUND`      | 404  | La colección no existe en esa organización.                                |
| `DOCUMENT_NOT_FOUND`        | 404  | El documento no existe en esa organización, o fue borrado.                 |
| `EMAIL_UNAVAILABLE`         | 409  | Ya hay una cuenta con ese email.                                           |
| `LAST_OWNER`                | 409  | El cambio dejaría la organización sin owners.                              |
| `ALREADY_A_MEMBER`          | 409  | La persona ya es miembro de la organización.                               |
| `COLLECTION_NAME_TAKEN`     | 409  | Ya hay una colección con ese nombre, sin distinguir mayúsculas.            |
| `COLLECTION_NOT_EMPTY`      | 409  | La colección todavía tiene documentos.                                     |
| `DOCUMENT_NOT_AVAILABLE`    | 409  | El documento no está guardado (`UPLOADING`, `FAILED`) o se está borrando.  |
| `INVITATION_EXPIRED`        | 410  | La invitación venció.                                                      |
| `INVITATION_ALREADY_USED`   | 410  | La invitación ya se usó.                                                   |
| `INVITATION_REVOKED`        | 410  | La invitación fue cancelada o reemplazada.                                 |
| `PAYLOAD_TOO_LARGE`         | 413  | Un cuerpo JSON supera los 16 KB.                                           |
| `DOCUMENT_TOO_LARGE`        | 413  | El archivo supera `DOCUMENT_MAX_SIZE_BYTES`.                               |
| `DOCUMENT_TYPE_NOT_ALLOWED` | 415  | El tipo no está admitido, o el contenido no coincide con la extensión.     |
| `TOO_MANY_ATTEMPTS`         | 429  | Demasiados logins fallidos para ese email.                                 |
| `RATE_LIMITED`              | 429  | Demasiadas peticiones desde el mismo cliente. Incluye `Retry-After`.       |
| `SERVICE_UNAVAILABLE`       | 503  | Una dependencia no responde.                                               |
| `STORAGE_UNAVAILABLE`       | 503  | El almacenamiento de objetos no responde a una descarga.                   |
| `DOCUMENT_UPLOAD_FAILED`    | 503  | El archivo no se pudo guardar; el documento queda `FAILED`.                |
| `DOCUMENT_DELETE_FAILED`    | 503  | El objeto no se pudo borrar; el documento queda `DELETING`.                |
| `INTERNAL_ERROR`            | 500  | Error inesperado.                                                          |

El catálogo está tipado en [`packages/contracts/src/api-errors.ts`](../../packages/contracts/src/api-errors.ts) y lo comparten la API y la web.
