# @verarag/contracts

Contratos de los mensajes que intercambian los servicios de VeraRAG a través de NATS.

La API (NestJS) y el worker (Go) están escritos en lenguajes distintos. Para que no terminen usando payloads incompatibles, los dos validan contra los mismos archivos JSON Schema de este directorio. La decisión está explicada en el [ADR 0006](../../docs/adr/0006-shared-contracts-with-json-schema.md).

## Contenido

| Ruta                   | Qué es                                                               |
| ---------------------- | -------------------------------------------------------------------- |
| `schemas/events/`      | Un schema por tipo de evento, más el sobre (`envelope`) común.       |
| `schemas/status/`      | Payloads de estado, como el heartbeat del worker.                    |
| `examples/`            | Ejemplos válidos. Los tests de TypeScript y de Go los usan a la vez. |
| `src/`                 | Tipos, constantes y validador para TypeScript (`ajv`).               |
| `contracts.go`, `*.go` | Tipos, constantes y validador para Go. Los schemas van embebidos.    |

Este directorio es a la vez un paquete de pnpm (`@verarag/contracts`) y un módulo de Go (`github.com/ricardoverita/verarag/packages/contracts`). El worker lo usa mediante una directiva `replace` en su `go.mod`.

## Convenciones

- El tipo de un evento es también el subject de NATS donde se publica: `system.test`, y en el futuro `document.ingestion.requested`, etc.
- El `$id` de cada schema de evento es `urn:verarag:schema:events:<tipo>`. Así cada lenguaje encuentra el schema a partir del tipo.
- `version` indica la versión del `data` de ese tipo. Un cambio incompatible crea una versión nueva en lugar de modificar la existente.
- Los schemas exigen los campos obligatorios y sus tipos, pero no rechazan campos desconocidos. Un productor puede añadir un campo opcional antes de que todos los consumidores lo conozcan.

## Añadir un evento

1. Crea `schemas/events/<tipo>.schema.json` referenciando el envelope.
2. Añade un ejemplo válido en `examples/events/<tipo>.json`.
3. Añade el tipo y sus datos en `src/events.ts` y en `contracts.go`.
4. Ejecuta los tests de los dos lenguajes:

```bash
pnpm --filter @verarag/contracts test
cd packages/contracts && go test ./...
```

Los tests comprueban que los ejemplos son válidos, que se pueden decodificar en los tipos de Go sin campos desconocidos y que los objetos construidos con los tipos de cada lenguaje cumplen el schema.
