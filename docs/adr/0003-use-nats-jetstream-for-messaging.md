# ADR 0003: NATS JetStream para la comunicación entre servicios

- Estado: aceptada
- Fecha: 2026-10-09

## Contexto

La API y el worker tienen que comunicarse de forma asíncrona. Cuando exista la ingesta, la API pedirá procesar un documento y el worker irá informando de su avance:

```
document.ingestion.requested
document.ingestion.started
document.ingestion.progress
document.ingestion.completed
document.ingestion.failed
```

Esos mensajes tienen que sobrevivir a reinicios, repartirse entre varias réplicas del worker, reintentarse un número limitado de veces y no bloquear la cola cuando uno es inválido. Más adelante habrá otros consumidores (auditoría, notificaciones) interesados en los mismos eventos.

También queremos que sea ligero de ejecutar en local y razonable de operar en self-hosting.

## Decisión

Usamos NATS 2.15 con JetStream.

- **El subject es el tipo de evento**, con la forma `<dominio>.<proceso>.<hecho>`: `system.test` hoy, `document.ingestion.requested` en el futuro.
- **Un stream por dominio.** Hoy solo existe `SYSTEM` (`system.>`), con retención de 24 horas. Cuando llegue la ingesta se añadirá `DOCUMENTS` (`document.>`).
- **La API es dueña de los streams.** Los crea o actualiza al arrancar, así sus límites están definidos en un único sitio. El worker espera a que existan.
- **Cada worker es dueño de su consumidor durable** (`worker-system`), con ack explícito y un máximo de 5 entregas.
- **Los mensajes inválidos se terminan** (`Term`), no se reintentan: reintentar un payload roto no lo arregla.
- **El id del evento viaja como `Nats-Msg-Id`**, y JetStream descarta duplicados dentro de una ventana de 2 minutos.
- **Un bucket key-value** (`worker-heartbeats`) guarda el heartbeat de cada instancia del worker con un TTL de 30 segundos. La API lo lee para saber si hay workers vivos sin llamarlos directamente.

El detalle operativo está en [docs/architecture/messaging.md](../architecture/messaging.md).

## Alternativas consideradas

- **BullMQ sobre Redis.** Muy cómodo en Node, pero los clientes para Go no son oficiales y acoplaríamos las colas a Redis, cuya persistencia no está pensada para trabajo que no se puede perder. Lo descartamos explícitamente como canal entre NestJS y Go.
- **RabbitMQ.** Maduro y con buen enrutamiento. Más pesado de operar y sin el key-value ni el request/reply integrados que ya nos da NATS en un solo binario.
- **Kafka o Redpanda.** Excelentes para logs de eventos de alto volumen, pero sobredimensionados para nuestra escala, y el modelo de ack y reintento por mensaje requiere más trabajo.
- **Una cola en PostgreSQL (`SKIP LOCKED`, pgmq).** Un componente menos y encolado transaccional. A cambio, sondeo y carga extra sobre la fuente de verdad, y el fan-out a varios consumidores es incómodo.
- **Colas de un proveedor cloud (SQS, Pub/Sub).** Atan el proyecto a un proveedor y complican el self-hosting.

## Consecuencias

- Un binario pequeño que arranca en segundos en local, con clientes oficiales para TypeScript y Go.
- La entrega es _al menos una vez_: los handlers tienen que ser idempotentes. Hoy es trivial (solo se registra un log); en la ingesta habrá que diseñarlo a propósito.
- Escribir en PostgreSQL y publicar en NATS no es atómico. Cuando un evento dependa de una escritura (por ejemplo, registrar un documento y pedir su ingesta) usaremos el patrón outbox. No lo implementamos ahora porque todavía no hay escrituras que proteger.
- El entorno local ejecuta un solo nodo de NATS y sin autenticación. En producción hacen falta credenciales (nkeys o JWT), TLS y streams replicados; eso pertenece a la fase 12.

## Trade-offs

- JetStream exige aprender sus conceptos (streams, consumidores, políticas de entrega). Lo compensamos documentando las convenciones y concentrando la configuración en la API.
- Revisaremos la decisión si el volumen de eventos o la necesidad de reprocesar históricos largos hacen que un log distribuido como Kafka tenga más sentido.
