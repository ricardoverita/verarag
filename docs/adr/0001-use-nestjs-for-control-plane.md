# ADR 0001: NestJS como control plane y API principal

- Estado: aceptada
- Fecha: 2026-10-09

## Contexto

VeraRAG necesita un servicio central que reciba las peticiones de la interfaz y de integraciones externas. Con el tiempo ese servicio va a concentrar autenticación, organizaciones, usuarios, colecciones, metadatos de documentos, permisos, API keys, auditoría y la orquestación de las consultas RAG (recuperar evidencia, llamar al LLM, devolver la respuesta con sus fuentes).

Casi todo ese trabajo es de entrada y salida: leer y escribir en PostgreSQL, publicar eventos, llamar a proveedores de LLM. Lo que más pesa no es el rendimiento bruto sino que el código se mantenga ordenado cuando haya veinte módulos con reglas de permisos cruzadas, y que se pueda probar sin levantar la infraestructura.

El frontend está en TypeScript y compartir tipos con la API sin generar código es una ventaja real.

## Decisión

El control plane es una aplicación NestJS 12 sobre Node.js 24 LTS, escrita en TypeScript estricto y como módulos ES.

- Adaptador HTTP de Express, que es el que asumen la mayoría de librerías del ecosistema Nest.
- Un módulo por capacidad (`config`, `observability`, `database`, `storage`, `messaging`, `health`, `dev`), sin capas extra de repositorios o casos de uso mientras no hagan falta.
- Configuración validada con Zod antes de arrancar Nest; validación de entrada con Standard Schema (Zod) en lugar de decoradores de `class-validator`.
- Logs JSON con pino, métricas con el cliente oficial de Prometheus y tests con Vitest.
- La infraestructura (PostgreSQL, NATS, S3) queda detrás de clases pequeñas que se sustituyen en los tests mediante la inyección de dependencias de Nest.

## Alternativas consideradas

- **Express o Fastify sin framework.** Suficiente para un servicio pequeño, pero tendríamos que inventar nuestras propias convenciones de módulos, ciclo de vida e inyección. El control plane va a crecer, y esas convenciones ya existen en Nest.
- **Go también para la API.** Un lenguaje menos que mantener. Lo descartamos porque la API es sobre todo lógica de negocio y CRUD, donde Go es más verboso, y porque compartir tipos con el frontend exigiría generación de código. Además, los SDK de proveedores de LLM y las librerías de RAG suelen llegar antes y más completos a TypeScript y Python.
- **Python con FastAPI.** El ecosistema de IA es el más rico, pero sumaría un tercer lenguaje o nos obligaría a reemplazar Go en el worker. Si en la fase de evaluación (fase 10) necesitamos Python, irá como un servicio aislado.
- **Fastify como adaptador de Nest.** Más rápido, pero la latencia de VeraRAG la dominarán las llamadas a modelos y la base de datos, no el framework HTTP.

## Consecuencias

- Los módulos y la inyección de dependencias permiten probar la API con dobles en memoria: los tests HTTP no necesitan Docker.
- Nest añade decoradores y metadatos que hay que entender. Requiere `emitDecoratorMetadata`, y las herramientas de test tienen que soportarlo (Vitest lo hace a través de oxc).
- Nest 12 publica sus paquetes como ESM. Algunas dependencias siguen siendo CommonJS y necesitan algún ajuste de importación (por ejemplo, `ajv-formats`).
- Hay que vigilar que la estructura no se convierta en "Java empresarial escrito en TypeScript": las abstracciones se añaden cuando hay un segundo caso que las justifique.

## Trade-offs

- Node.js ejecuta el código de la aplicación en un solo hilo. El trabajo intensivo en CPU (extraer texto de documentos, partirlo, preparar lotes de embeddings) no debe ejecutarse en la API; ese trabajo va al worker de Go ([ADR 0002](0002-use-go-for-ingestion-workers.md)).
- Elegimos productividad y estructura antes que el mínimo consumo de memoria. Una instancia de la API ocupa más que un binario de Go equivalente.
- Revisaremos la decisión si la API empieza a necesitar procesamiento pesado propio o si mantener dos lenguajes deja de compensar.
