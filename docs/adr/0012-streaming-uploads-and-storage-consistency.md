# ADR 0012: Subidas en streaming a través de la API y consistencia entre PostgreSQL y S3

- Estado: aceptada
- Fecha: 2026-10-11

## Contexto

En la fase 2 las organizaciones suben documentos. Los metadatos van a PostgreSQL y el contenido al almacenamiento de objetos ([ADR 0007](0007-s3-compatible-object-storage.md)). Hay que decidir dos cosas:

1. **Por dónde pasa el archivo.** El navegador habla con la web, la web reenvía `/api/v1` a la API desde su servidor ([ADR 0008](0008-sessions-in-postgresql.md)), y la API habla con S3. Un archivo de 25 MiB, o de varios GiB si se sube el límite, no puede cargarse entero en memoria en ninguno de los saltos.
2. **Cómo se mantienen de acuerdo PostgreSQL y S3.** No existe una transacción que abarque los dos. Cualquier orden de escritura deja una ventana en la que uno tiene algo que el otro no.

## Decisión

### El archivo pasa en streaming por la web y por la API

```
navegador ─stream→ Next.js (/api/v1) ─stream→ NestJS ─stream→ S3 (multipart)
```

- **Navegador → Next.js.** Un `XMLHttpRequest` con `multipart/form-data`. Su `upload.onprogress` da el progreso real de lo enviado.
- **Next.js → NestJS.** El route handler reenvía `request.body`, que Next.js entrega sin leer, con `duplex: 'half'`. Next.js solo bufferiza los cuerpos de las rutas que matchea `proxy.ts` (hasta 10 MB, y después trunca sin avisar), así que `/api` nunca debe entrar en ese matcher. Un test lo comprueba.
- **NestJS → S3.** La API no usa un body parser para multipart. `busboy` lee el request directamente y la parte del archivo atraviesa, con backpressure, un inspector que cuenta bytes, corta en el límite, calcula SHA-256 y valida el contenido. Después la subida multipart de `@aws-sdk/lib-storage` la envía en partes de 5 MiB, con dos en vuelo como máximo.

Así la memoria de una subida queda acotada por el tamaño de parte, no por el del archivo. Medido en Docker Compose, el pico de memoria de la API creció unos 34 MiB al pasar de un archivo de 24 MiB a uno de 200 MiB. Con la API pausada a mitad de una subida, la web dejó de aceptar datos después de unos 18 MiB en buffers del sistema, sin crecer en memoria.

### PostgreSQL primero, y estados que se pueden recuperar

- **Antes del primer byte**, la API inserta la fila del documento como `UPLOADING`. La clave del objeto se deriva de los ids, en una columna generada. Así **nunca hay un objeto sin una fila que lo nombre**: lo que quede a medias en S3 siempre se puede encontrar desde PostgreSQL.
- **Al terminar**, la API comprueba con `HEAD` que el objeto tiene exactamente los bytes enviados y pasa la fila a `AVAILABLE` con su tamaño y su SHA-256.
- **Si algo falla** en medio, la fila pasa a `FAILED` con un motivo, y la API borra lo que haya llegado a S3, best effort.
- **Borrar tiene dos pasos.** Primero `DELETING`: el documento deja de descargarse y el borrado queda auditado. Después se borra el objeto, y recién entonces la fila pasa a `DELETED`. Si S3 falla, el documento queda en `DELETING`, visible, y repetir el borrado retoma el segundo paso.
- **Las transiciones son compare-and-set.** Cada `UPDATE` exige el estado previo. Si un borrado y una subida se cruzan, gana el borrado, y la subida elimina el objeto que acababa de escribir.

Las tres situaciones que nos preocupaban quedan así:

| Situación                                               | Qué queda                                                       | Cómo se recupera hoy                                                                     |
| ------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| La fila existe pero la subida a S3 falla                | `FAILED` con `storage_error`; la parte subida se aborta o borra | Visible en la lista; se sube otra vez y el fallido se borra                              |
| S3 terminó pero la API cayó antes de marcar `AVAILABLE` | `UPLOADING` con un objeto completo o parcial                    | Borrar el documento elimina el objeto; `verarag_documents{status="UPLOADING"}` lo delata |
| El borrado no llegó a S3                                | `DELETING` con el objeto todavía guardado                       | Visible en la lista; repetir el borrado termina                                          |

Una tarea de reconciliación futura no necesita nada más que lo que ya está en la base de datos. Hay un índice parcial sobre `UPLOADING` y `DELETING` por fecha de actualización. Podrá:

- marcar `FAILED` (`interrupted`) los `UPLOADING` de más de una hora, y borrar su objeto;
- reintentar el borrado de los `DELETING`;
- comparar el bucket con la tabla para encontrar objetos de documentos que ya no existen.

## Alternativas consideradas

- **URLs prefirmadas: el navegador sube directo a S3.** Es lo más eficiente para archivos grandes, porque los bytes no pasan por nuestros servidores. A cambio:
  - el bucket tiene que ser alcanzable desde internet y aceptar CORS;
  - la validación de tipo, tamaño y checksum pasa a hacerse después, leyendo el objeto otra vez;
  - una URL filtrada sirve hasta que vence;
  - la subida tiene un tercer paso, "confirmar", que también puede perderse.

  Con streaming, la API controla todo en una sola pasada y el bucket sigue privado. Sería la opción si los archivos crecen a cientos de MiB de forma habitual, o si el tráfico de subida empieza a pesar en la API.

- **Escribir primero en S3 y después la fila.** Una caída entre los dos pasos deja objetos que nada nombra, y encontrarlos exige recorrer todo el bucket.
- **Guardar el archivo en disco o en memoria antes de enviarlo a S3.** Más simple de escribir, pero el uso de memoria o de disco crece con cada subida concurrente, y un archivo grande puede tumbar el proceso.
- **Borrar la fila al borrar el documento.** Perdería la trazabilidad y no dejaría un estado del que recuperarse si S3 falla.

## Consecuencias

- Los bytes atraviesan la web y la API. Cada subida en curso ocupa una conexión y unos 10 MiB de memoria de partes en la API, que tiene un límite de 30 subidas por minuto por cliente.
- No hay transacción entre PostgreSQL y S3, y no lo ocultamos: pueden quedar documentos `UPLOADING` o `DELETING` que alguien tiene que mirar, por ahora a mano.
- Un rechazo a mitad de subida responde enseguida y descarta, como mucho, 4 MiB o 5 segundos del resto antes de cerrar la conexión. Así el cliente recibe el error en lugar de un reset, y una subida gigante no se lee entera.

## Trade-offs

Elegimos un único camino, controlado de punta a punta y con el bucket privado, a costa de que los bytes pasen por nuestros servidores. Revisaremos la decisión si:

- el límite habitual de tamaño pasa de unos cientos de MiB, o las subidas concurrentes empiezan a pesar en la API: entonces, URLs prefirmadas con un paso de verificación;
- aparecen documentos atascados con frecuencia: entonces, la tarea de reconciliación pasa de ser una idea documentada a código.
