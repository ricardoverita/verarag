# ADR 0011: SQL explícito con node-postgres e ids UUIDv7

- Estado: aceptada
- Fecha: 2026-10-10

## Contexto

El [ADR 0004](0004-use-postgresql-and-pgvector.md) dejó para cuando existieran tablas la elección entre SQL directo, un query builder o un ORM. La fase 1 crea las primeras: `users`, `organizations`, `memberships`, `sessions`, `invitations`, `api_keys` y `audit_events`. También hay que elegir el tipo de los identificadores, que aparecen en URLs y se comparten entre la API y, en el futuro, el worker.

## Decisión

**Acceso a datos.** La API sigue usando `node-postgres` con SQL escrito a mano, dentro de repositorios pequeños por tabla (`UsersRepository`, `MembershipsRepository`...). Cada método recibe un `Queryable`, que es o el pool o una transacción, así el servicio decide qué operaciones son atómicas. Las filas se convierten a objetos con tipos explícitos en el propio repositorio. Las migraciones siguen siendo SQL plano con dbmate, con claves foráneas, `CHECK` y `ON DELETE RESTRICT` salvo donde borrar en cascada es lo correcto (las sesiones de un usuario).

**Identificadores.** UUIDv7 generados por PostgreSQL 18 con `DEFAULT uuidv7()`:

- Son únicos sin coordinación, como cualquier UUID, y no permiten adivinar ids vecinos como un entero secuencial.
- Empiezan por la marca de tiempo, así que las inserciones van al final del índice B-tree en lugar de repartirse por todo él como con UUIDv4. Y ordenar por id es ordenar por fecha de creación.
- Los genera la base de datos: la aplicación no necesita una librería ni puede equivocarse de versión.

## Alternativas consideradas

- **Prisma, TypeORM o MikroORM.** Ahorran SQL repetitivo, pero esconden las consultas justo donde más importa verlas: el filtro por organización, los `FOR UPDATE` que protegen al último owner y el orden de los bloqueos. Prisma, además, trae su propio motor y su propio lenguaje de esquema, y chocaría con las migraciones de dbmate.
- **Drizzle o Kysely.** Query builders tipados y ligeros, la alternativa más razonable. Hoy son pocas tablas y consultas sencillas; si el número de consultas crece y los tipos escritos a mano empiezan a desviarse, Kysely encaja sin cambiar las migraciones.
- **Enteros secuenciales.** Más pequeños y rápidos, pero revelan el volumen y permiten enumerar recursos. Habría que añadir un id público aparte.
- **UUIDv4.** Aleatorios del todo, pero fragmentan los índices y no se pueden ordenar.

## Consecuencias

- Cada consulta se lee tal cual se ejecuta. A cambio, hay que escribir a mano el mapeo de filas y mantener sus tipos.
- Un UUIDv7 revela el momento en que se creó el recurso, con precisión de milisegundos. No lo consideramos sensible para organizaciones, membresías, invitaciones o API keys; si algún recurso lo fuera, usaría otro identificador público.
- `uuidv7()` exige PostgreSQL 18, que ya era la versión elegida en el ADR 0004.

## Trade-offs

Elegimos consultas visibles y una dependencia menos a costa de algo más de código repetitivo. Revisaremos la decisión si el mapeo de filas a mano empieza a producir errores de tipos, o cuando el worker tenga que escribir en las mismas tablas y convenga compartir definiciones.
