# Architecture Decision Records

Cada ADR recoge una decisión de arquitectura: el problema que había, lo que se decidió, las alternativas que se descartaron y lo que cuesta la decisión. Sirven para que alguien que llega al proyecto entienda por qué las cosas son como son, y para saber cuándo conviene revisarlas.

| ADR                                                 | Decisión                                                    | Estado   |
| --------------------------------------------------- | ----------------------------------------------------------- | -------- |
| [0001](0001-use-nestjs-for-control-plane.md)        | NestJS como control plane y API principal                   | Aceptada |
| [0002](0002-use-go-for-ingestion-workers.md)        | Go para los workers de ingesta                              | Aceptada |
| [0003](0003-use-nats-jetstream-for-messaging.md)    | NATS JetStream para la comunicación entre servicios         | Aceptada |
| [0004](0004-use-postgresql-and-pgvector.md)         | PostgreSQL como fuente de verdad y pgvector para embeddings | Aceptada |
| [0005](0005-monorepo-structure.md)                  | Un monorepo políglota con pnpm y módulos de Go              | Aceptada |
| [0006](0006-shared-contracts-with-json-schema.md)   | Contratos compartidos con JSON Schema                       | Aceptada |
| [0007](0007-s3-compatible-object-storage.md)        | Almacenamiento de objetos a través de la API de S3          | Aceptada |
| [0008](0008-sessions-in-postgresql.md)              | Sesiones opacas en PostgreSQL y límites de tasa en memoria  | Aceptada |
| [0009](0009-local-credentials-first-oidc-later.md)  | Credenciales propias primero, OIDC después                  | Aceptada |
| [0010](0010-tenant-isolation-in-the-application.md) | Aislamiento entre organizaciones en la aplicación, sin RLS  | Aceptada |
| [0011](0011-explicit-sql-and-uuidv7.md)             | SQL explícito con node-postgres e ids UUIDv7                | Aceptada |

## Cómo escribir uno

1. Copia la estructura de cualquier ADR existente y usa el siguiente número libre.
2. Secciones: contexto, decisión, alternativas consideradas, consecuencias y trade-offs. Si hay una condición concreta que haría cambiar la decisión, escríbela.
3. Los ADR no se reescriben. Si una decisión cambia, se crea uno nuevo que la reemplaza y el anterior pasa a estado _Reemplazada por XXXX_.

Los ADR están en español, como el resto de la documentación técnica por ahora.
