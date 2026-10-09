# ADR 0004: PostgreSQL como fuente de verdad y pgvector para embeddings

- Estado: aceptada
- Fecha: 2026-10-09

## Contexto

VeraRAG tiene que guardar organizaciones, usuarios, permisos, colecciones, metadatos de documentos, fragmentos y sus embeddings. La parte delicada es la recuperación: cuando alguien pregunta, solo pueden aparecer fragmentos de documentos que esa persona tiene permiso para ver, dentro de su organización.

Si los vectores viven en un sistema distinto de los permisos, hay que sincronizar ambos y cualquier desfase se convierte en una fuga de información. También queremos mantener pocas piezas de infraestructura mientras el producto toma forma.

## Decisión

PostgreSQL 18 es la fuente de verdad y pgvector 0.8.7 guarda los embeddings en la misma base de datos. En local usamos la imagen `pgvector/pgvector:0.8.7-pg18`.

- Los vectores viven junto a sus metadatos, así que filtrar por organización, colección o permiso es una condición SQL más de la misma consulta.
- Las migraciones son archivos SQL en `apps/api/db/migrations`, aplicados con [dbmate](https://github.com/amacneil/dbmate). Son independientes del lenguaje: el worker podrá escribir en las mismas tablas sin depender del tooling de TypeScript.
- La API (control plane) es dueña del esquema.
- La primera migración solo habilita la extensión `vector`. No hay tablas todavía; la API comprueba en su estado que la extensión está instalada y muestra su versión.
- La API usa `node-postgres` directamente. Elegiremos query builder u ORM cuando existan las primeras tablas, no antes.

## Alternativas consideradas

- **Una base de datos vectorial dedicada (Qdrant, Weaviate, Milvus).** Mejor rendimiento y más funciones de búsqueda aproximada a gran escala. A cambio, otro sistema que asegurar, respaldar y mantener sincronizado con los permisos.
- **OpenSearch o Elasticsearch.** Muy buenos para búsqueda léxica y combinada con vectores. Más pesados de operar. Los evaluaremos si la fase 7 (búsqueda híbrida) muestra que PostgreSQL se queda corto.
- **Migraciones con un ORM (Prisma, TypeORM, Drizzle).** Atarían el esquema al tooling de TypeScript. SQL plano con dbmate es más fácil de leer y de revisar.

## Consecuencias

- Una sola base de datos que respaldar, con transacciones que cubren a la vez los metadatos y los vectores.
- Los permisos se aplican en la misma consulta que la búsqueda semántica.
- Hay que vigilar el tamaño de los índices HNSW, que viven en memoria, y la carga de escritura durante la ingesta, que compite con las consultas de la aplicación.

## Trade-offs

pgvector es suficiente para la primera etapa y reduce la infraestructura necesaria. Si el volumen o los requisitos de búsqueda híbrida cambian, podremos evaluar OpenSearch u otros motores posteriormente.

En concreto, revisaremos la decisión si:

- las colecciones llegan a decenas de millones de fragmentos y el recall o la latencia no se pueden mantener con particionado e índices;
- la búsqueda léxica de PostgreSQL (`tsvector`, que no es BM25) no da resultados aceptables en las pruebas de la fase 7.
