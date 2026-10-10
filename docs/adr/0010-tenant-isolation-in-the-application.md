# ADR 0010: Aislamiento entre organizaciones en la aplicación, sin RLS por ahora

- Estado: aceptada
- Fecha: 2026-10-10

## Contexto

Todas las organizaciones comparten la misma base de datos. Una consulta a la que le falte un filtro por organización es una fuga de datos entre clientes, y en una plataforma de conocimiento es el peor fallo posible. Hay que decidir dónde se aplica ese filtro y cómo nos aseguramos de que no se olvida.

## Decisión

El aislamiento se aplica en la API, en tres capas que se refuerzan:

1. **Un único guard decide el acceso.** Toda ruta con `:organizationId` pasa por `OrganizationAccessGuard`, que busca la membresía activa del usuario en esa organización y comprueba el rol pedido con `@OrganizationRoles(...)`. El `organizationId` que manda el cliente nunca se usa sin esa comprobación. Quien no es miembro recibe `404 ORGANIZATION_NOT_FOUND`, exactamente igual que si la organización no existiera, para que los ids no sirvan para averiguar qué organizaciones existen.
2. **Los repositorios exigen la organización.** Las consultas de membresías, invitaciones y API keys reciben `{ id, organizationId }`, nunca un id suelto. Un id de otra organización simplemente no se encuentra. Las únicas excepciones son búsquedas por un secreto (hash de sesión, de invitación o prefijo de API key), que es la forma de descubrir a qué organización pertenece quien lo presenta.
3. **Tests dedicados.** Hay suites de integración contra PostgreSQL real que crean dos organizaciones y comprueban que la persona de una no puede leer, modificar, listar ni borrar nada de la otra: organización, miembros, invitaciones y API keys, también usando ids válidos de la otra organización bajo la ruta de la propia.

Además, las rutas por defecto exigen sesión (`AuthGuard` global con `@Public()` como excepción explícita) y las API keys solo funcionan en rutas marcadas con `@ApiKeyScopes(...)`.

## Alternativas consideradas

- **Row Level Security de PostgreSQL desde ya.** Es la defensa más fuerte: la base de datos rechaza filas de otra organización aunque la aplicación olvide el filtro. A cambio, cada transacción tiene que fijar la organización (`SET LOCAL app.organization_id`), los tests y las migraciones se complican, y las consultas legítimas que cruzan organizaciones (listar las de un usuario, autenticar un token) necesitan políticas o roles aparte. Con cuatro tablas y un único servicio que escribe, preferimos que la regla sea visible en el código y esté cubierta por tests.
- **Una base de datos o un esquema por organización.** Aislamiento físico, pero migraciones multiplicadas, conexiones por cliente y consultas globales imposibles. No encaja con un producto self-hosted que puede tener cientos de organizaciones pequeñas.

## Consecuencias

- Un filtro olvidado en una consulta nueva no lo detecta la base de datos. Lo mitigan la convención de los repositorios, la revisión de código y los tests de aislamiento, que cada recurso nuevo con datos de una organización debe ampliar.
- Las respuestas 404 no distinguen "no existe" de "no tienes acceso", lo que hace un poco más difícil depurar desde fuera.

## Trade-offs

Elegimos claridad y velocidad de desarrollo en esta fase a costa de una defensa en profundidad que añadiremos más adelante. Activaremos RLS, como segunda barrera y no como sustituto del guard, en la fase 9 (permisos empresariales), o antes si:

- aparecen tablas con datos de documentos o fragmentos, que es cuando una fuga deja de ser de metadatos;
- otro servicio, como el worker, empieza a leer o escribir esas tablas con sus propias consultas.
