# ADR 0002: Go para los workers de ingesta

- Estado: aceptada
- Fecha: 2026-10-09

## Contexto

Antes de poder responder preguntas, VeraRAG tiene que procesar documentos: descargarlos del almacenamiento de objetos, extraer el texto, normalizarlo, partirlo en fragmentos, pedir embeddings a un proveedor en lotes, guardar los vectores y volver a indexar cuando algo cambia.

Ese trabajo es largo, usa CPU y memoria de forma irregular y tiene que tolerar fallos parciales: un PDF corrupto, un proveedor de embeddings que limita la tasa, un worker que se reinicia a mitad de un lote. Necesitamos concurrencia controlada, reintentos acotados y poder ejecutar varias réplicas sin que se pisen.

Hoy no hay ingesta. El worker de esta fase solo consume el evento de prueba `system.test`, publica su heartbeat y expone health y métricas.

## Decisión

El data plane es un worker escrito en Go 1.27.

- Biblioteca estándar siempre que alcance: `log/slog` para logs JSON, `net/http` para health y métricas, `context` y señales para el apagado ordenado.
- `nats.go` con la API `jetstream` para consumir mediante un consumidor durable compartido por todas las réplicas.
- Configuración desde variables de entorno, validada al arrancar y con todos los errores a la vez.
- Imagen final `distroless/static` de unos 13 MB, sin shell; el propio binario implementa `worker healthcheck` para Docker.
- La API y el worker no se llaman directamente: solo se comunican por NATS, con payloads definidos en `packages/contracts`.

## Alternativas consideradas

- **Un worker de Node.js en el mismo código que la API (por ejemplo con BullMQ).** Lo más sencillo para compartir código, pero el procesamiento intensivo bloquea el event loop. Resolverlo con `worker_threads` añade complejidad y la memoria por proceso es mayor.
- **Python.** Tiene el mejor ecosistema para extraer texto de documentos y para ML. A cambio, la concurrencia está limitada por el GIL, las imágenes son grandes y el despliegue es más delicado. Si un extractor concreto solo existe en Python, podemos llamarlo como servicio auxiliar sin mover todo el worker.
- **Rust.** Rendimiento y control de memoria excelentes, pero más lento de desarrollar y con un ecosistema menor para lo que necesitamos.

## Consecuencias

- Goroutines y contextos facilitan limitar la concurrencia, cancelar trabajo y apagar sin perder mensajes: el worker deja de pedir mensajes, termina los que tiene en curso, borra su heartbeat y cierra la conexión.
- Binarios estáticos, arranque rápido y poca memoria por réplica.
- La frontera entre lenguajes obliga a mantener la separación: no hay forma de que el worker lea por accidente el estado interno de la API.
- Dos lenguajes implican dos toolchains en CI, contratos explícitos ([ADR 0006](0006-shared-contracts-with-json-schema.md)) y contribuidores que necesitan conocer ambos para cambios que crucen la frontera.

## Trade-offs

- El ecosistema de Go para extraer texto de PDF y DOCX es más pobre que el de Python. Cuando llegue la fase 3 decidiremos entre librerías de Go, herramientas externas (Apache Tika, `pdftotext`) o un extractor auxiliar en Python. Este ADR no lo resuelve.
- Revisaremos la decisión si la mayor parte del trabajo del worker termina siendo llamadas a servicios externos, sin procesamiento propio que justifique un lenguaje aparte.
