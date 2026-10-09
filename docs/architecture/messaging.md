# Mensajería

La API y el worker se comunican solo a través de NATS JetStream. La decisión está en el [ADR 0003](../adr/0003-use-nats-jetstream-for-messaging.md); aquí están las convenciones.

## Subjects y tipos de evento

El tipo de un evento es también el subject donde se publica. Siguen la forma `<dominio>.<proceso>.<hecho>`, en minúsculas y separados por puntos:

| Subject / tipo                 | Estado       | Quién publica | Quién consume |
| ------------------------------ | ------------ | ------------- | ------------- |
| `system.test`                  | Implementado | API           | worker        |
| `document.ingestion.requested` | Planificado  | API           | worker        |
| `document.ingestion.started`   | Planificado  | worker        | API           |
| `document.ingestion.progress`  | Planificado  | worker        | API           |
| `document.ingestion.completed` | Planificado  | worker        | API           |
| `document.ingestion.failed`    | Planificado  | worker        | API           |

Los hechos se nombran en pasado (`completed`, `failed`). Las peticiones de trabajo usan `requested`.

## Envelope

Todos los eventos comparten el mismo sobre, definido en [`envelope.schema.json`](../../packages/contracts/schemas/events/envelope.schema.json):

```json
{
  "id": "0b8f6a4e-5c1d-4e2f-9a3b-7d6c5e4f3a2b",
  "type": "system.test",
  "version": 1,
  "source": "api",
  "occurredAt": "2026-10-09T10:15:30.000Z",
  "correlationId": "5f2b9c1e-8d4a-4b6f-a1c3-e7d9f0b2a4c6",
  "data": { "message": "hello from VeraRAG" }
}
```

- `id`: UUID del evento. También se envía como cabecera `Nats-Msg-Id`.
- `type`: igual al subject.
- `version`: versión del `data` de ese tipo.
- `correlationId`: id de la petición que originó el evento. La API usa su `x-request-id`, así que se puede seguir una petición desde la API hasta el log del worker.

## Cabeceras

| Cabecera      | Para qué                                                                          |
| ------------- | --------------------------------------------------------------------------------- |
| `Nats-Msg-Id` | Deduplicación: JetStream ignora un id repetido dentro de la ventana de 2 minutos. |
| `traceparent` | Contexto de traza W3C. El worker continúa la traza que empezó en la API.          |

## Streams

Los crea y actualiza la API al arrancar, en `apps/api/src/messaging/nats.client.ts`.

| Stream      | Subjects     | Retención                | Límites                                                         | Estado       |
| ----------- | ------------ | ------------------------ | --------------------------------------------------------------- | ------------ |
| `SYSTEM`    | `system.>`   | Por límites, 24 horas    | 10 000 mensajes, 64 KiB por mensaje, deduplicación de 2 minutos | Implementado |
| `DOCUMENTS` | `document.>` | Por definir en la fase 3 | Por definir                                                     | Planificado  |

## Consumidores

| Consumidor      | Stream   | Filtro     | Configuración                                                            |
| --------------- | -------- | ---------- | ------------------------------------------------------------------------ |
| `worker-system` | `SYSTEM` | `system.>` | Durable, ack explícito, `AckWait` 30 s, máximo 5 entregas, 64 pendientes |

Todas las réplicas del worker comparten el consumidor durable, así que cada evento lo procesa una sola de ellas.

## Semántica de entrega

La entrega es **al menos una vez**. Para cada mensaje el worker:

1. Valida el payload contra el schema de su subject.
2. Si no es válido, o el subject no tiene schema, lo **termina** (`TermWithReason`). Un mensaje inválido no mejora al reintentarlo.
3. Si el handler falla, hace **nak con espera de 5 segundos** y JetStream lo vuelve a entregar, hasta 5 veces.
4. Si todo va bien, hace **ack**.

Como un mensaje puede llegar más de una vez (por ejemplo, si el worker muere después de procesar y antes del ack), los handlers deben ser idempotentes.

## Heartbeats del worker

Cada instancia del worker escribe en el bucket key-value `worker-heartbeats`:

- clave: id de la instancia (el hostname del contenedor por defecto);
- valor: [`worker-heartbeat.schema.json`](../../packages/contracts/schemas/status/worker-heartbeat.schema.json);
- cada 10 segundos, solo mientras está conectada a NATS y consumiendo;
- TTL del bucket: 30 segundos;
- al apagarse borra su entrada.

La API lee el bucket para el estado del sistema. Una entrada presente significa un worker vivo.

## Probarlo a mano

Con el entorno levantado y `DEV_ENDPOINTS_ENABLED=true`:

```bash
curl -X POST http://localhost:3001/api/v1/dev/events \
  -H 'Content-Type: application/json' \
  -d '{"type": "system.test", "message": "hello from VeraRAG"}'

docker compose logs worker
```

Para inspeccionar JetStream se puede usar la CLI de NATS desde un contenedor:

```bash
docker run --rm --network verarag_backend natsio/nats-box nats --server nats://nats:4222 stream info SYSTEM
```

## Añadir un evento

Sigue los pasos del [README de los contratos](../../packages/contracts/README.md). Si el evento pertenece a un dominio nuevo, añade también su stream en la API y documéntalo aquí.
