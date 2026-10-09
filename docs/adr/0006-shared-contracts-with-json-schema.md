# ADR 0006: Contratos compartidos con JSON Schema

- Estado: aceptada
- Fecha: 2026-10-09

## Contexto

La API (TypeScript) publica eventos que el worker (Go) consume, y el worker escribe heartbeats que la API lee. Si cada lado define sus propios tipos, tarde o temprano divergen: un campo renombrado en la API deja al worker leyendo un valor vacío sin que ningún compilador lo detecte.

Hoy hay un evento y un payload de estado. Con la ingesta habrá varios más (`document.ingestion.*`), así que la solución tiene que escalar a decenas de mensajes sin volverse pesada de mantener.

## Decisión

Los contratos viven en `packages/contracts` y su fuente de verdad son archivos **JSON Schema (draft 2020-12)**.

- Un **envelope** común para todos los eventos, inspirado en CloudEvents pero con nombres en camelCase: `id`, `type`, `version`, `source`, `occurredAt`, `correlationId` y `data`.
- **Un schema por tipo de evento**, que referencia el envelope y define su `data`. El `$id` sigue la convención `urn:verarag:schema:events:<tipo>`, y el tipo coincide con el subject de NATS.
- **Validación en tiempo de ejecución en ambos lados**: la API valida cada evento con `ajv` antes de publicarlo y el worker valida cada mensaje recibido con `santhosh-tekuri/jsonschema`. Los dos leen los mismos archivos; Go los embebe en el binario.
- **Tipos escritos a mano** en TypeScript y en Go, protegidos por tests que usan los mismos ejemplos (`examples/`): los ejemplos tienen que validar, decodificarse en los tipos de Go sin campos desconocidos, y los objetos construidos con los tipos de cada lenguaje tienen que cumplir el schema.
- **Versionado por tipo**: `version` indica la versión de `data`. Un cambio incompatible crea una versión nueva y durante la transición los consumidores aceptan ambas.
- **Lectores tolerantes**: los schemas exigen los campos obligatorios y sus tipos, pero no rechazan campos desconocidos. Así un productor puede añadir un campo opcional sin coordinar un despliegue simultáneo.

## Alternativas consideradas

- **Protobuf con buf.** Tipado fuerte, generación de código y mensajes compactos. Pero los mensajes binarios son más difíciles de inspeccionar con la CLI de `nats`, requiere toolchain de generación para dos lenguajes y JSON es suficiente a nuestro volumen. Lo reconsideraremos si el tamaño o el rendimiento de los mensajes se vuelven un problema.
- **AsyncAPI.** Muy bueno para documentar canales y mensajes. Su generación de código para TypeScript y Go no cubre bien lo que necesitamos. Es probable que añadamos un documento AsyncAPI que referencie estos mismos schemas, como documentación.
- **OpenAPI.** Es para HTTP, no para eventos. Lo usaremos para la API pública cuando exista. El estado del sistema, que solo intercambian la API y la web (ambas en TypeScript), se comparte por ahora como tipos de TypeScript.
- **Generar los tipos desde los schemas** (quicktype, go-jsonschema, json-schema-to-typescript). Evita escribir tipos a mano, pero añade código generado y herramientas que mantener. Con pocos eventos, tipos manuales más tests es menos maquinaria. Lo revisaremos cuando haya más de diez eventos.

## Consecuencias

- Un productor que rompe el contrato falla antes de publicar, y un mensaje inválido que llega al worker se rechaza con un log claro en lugar de procesarse a medias.
- Los schemas son legibles y sirven como documentación de los payloads.
- Los tipos están duplicados en dos lenguajes. Los tests detectan las divergencias, pero hay que acordarse de actualizar ambos; el README del paquete lo explica paso a paso.
- Validar en cada mensaje tiene un coste. Hoy es despreciable y lo mediremos cuando el volumen crezca.

## Trade-offs

- Preferimos simplicidad y legibilidad frente a la eficiencia de un formato binario y a la comodidad de generar código.
- Esta decisión se revisará cuando el número de eventos haga pesado mantener los tipos a mano, o si aparece un tercer lenguaje que también tenga que consumirlos.
