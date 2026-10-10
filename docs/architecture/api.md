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
- El cuerpo admite como mucho 16 KB. Todas las respuestas llevan `Cache-Control: no-store` y las cabeceras de seguridad de helmet.

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

| Código                      | HTTP | Cuándo                                                               |
| --------------------------- | ---- | -------------------------------------------------------------------- |
| `VALIDATION_FAILED`         | 400  | El cuerpo, un parámetro o el JSON no son válidos.                    |
| `AUTHENTICATION_REQUIRED`   | 401  | La ruta necesita una sesión y no hay.                                |
| `INVALID_SESSION`           | 401  | La sesión no existe, fue revocada o el usuario está desactivado.     |
| `SESSION_EXPIRED`           | 401  | La sesión venció.                                                    |
| `INVALID_CREDENTIALS`       | 401  | Email o contraseña incorrectos, sin decir cuál de los dos.           |
| `INVALID_API_KEY`           | 401  | La API key no existe, está mal formada o fue alterada.               |
| `API_KEY_REVOKED`           | 401  | La API key fue revocada.                                             |
| `API_KEY_EXPIRED`           | 401  | La API key venció.                                                   |
| `FORBIDDEN_ORIGIN`          | 403  | Un POST, PATCH o DELETE llegó desde otro origen.                     |
| `INSUFFICIENT_ROLE`         | 403  | El rol en la organización no permite la acción.                      |
| `INSUFFICIENT_SCOPE`        | 403  | La API key no puede usar esta ruta.                                  |
| `INVITATION_EMAIL_MISMATCH` | 403  | La invitación es para otro email.                                    |
| `NOT_FOUND`                 | 404  | La ruta no existe.                                                   |
| `ORGANIZATION_NOT_FOUND`    | 404  | La organización no existe o quien pregunta no es miembro.            |
| `MEMBER_NOT_FOUND`          | 404  | La membresía no existe en esa organización.                          |
| `INVITATION_NOT_FOUND`      | 404  | El enlace de invitación no existe.                                   |
| `API_KEY_NOT_FOUND`         | 404  | La API key no existe en esa organización.                            |
| `EMAIL_UNAVAILABLE`         | 409  | Ya hay una cuenta con ese email.                                     |
| `LAST_OWNER`                | 409  | El cambio dejaría la organización sin owners.                        |
| `ALREADY_A_MEMBER`          | 409  | La persona ya es miembro de la organización.                         |
| `INVITATION_EXPIRED`        | 410  | La invitación venció.                                                |
| `INVITATION_ALREADY_USED`   | 410  | La invitación ya se usó.                                             |
| `INVITATION_REVOKED`        | 410  | La invitación fue cancelada o reemplazada.                           |
| `PAYLOAD_TOO_LARGE`         | 413  | El cuerpo supera los 16 KB.                                          |
| `TOO_MANY_ATTEMPTS`         | 429  | Demasiados logins fallidos para ese email.                           |
| `RATE_LIMITED`              | 429  | Demasiadas peticiones desde el mismo cliente. Incluye `Retry-After`. |
| `SERVICE_UNAVAILABLE`       | 503  | Una dependencia no responde.                                         |
| `INTERNAL_ERROR`            | 500  | Error inesperado.                                                    |

El catálogo está tipado en [`packages/contracts/src/api-errors.ts`](../../packages/contracts/src/api-errors.ts) y lo comparten la API y la web.
