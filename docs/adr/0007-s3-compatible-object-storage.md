# ADR 0007: Almacenamiento de objetos a través de la API de S3

- Estado: aceptada
- Fecha: 2026-10-09

## Contexto

Los documentos originales (PDF, DOCX, HTML...) tienen que guardarse fuera de PostgreSQL. VeraRAG debe funcionar tanto en self-hosting como en la nube, con AWS S3, Cloudflare R2 u otro servicio compatible con S3.

En desarrollo local se pidió usar MinIO. Al escribir este ADR (octubre de 2026), la imagen `minio/minio` ya no está disponible en Docker Hub y MinIO dejó de publicar imágenes de su edición community. Chainguard mantiene una build de MinIO actualizada y pública, aunque en su plan gratuito solo ofrece la etiqueta `latest`.

## Decisión

- **La API habla con el almacenamiento solo mediante la API de S3**, usando el SDK de AWS v3. Se configura con `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, credenciales y `S3_FORCE_PATH_STYLE`. Cambiar de MinIO a S3 o a R2 es cuestión de configuración.
- **Sin endpoint**, el SDK usa AWS S3. **Sin credenciales**, usa su cadena por defecto (variables de entorno, perfiles, roles de IAM).
- **El código de dominio dependerá de `ObjectStorage`**, una clase pequeña de la API, nunca de un SDK concreto de MinIO. Hoy solo comprueba con `HeadBucket` que el bucket existe y es accesible; subir y leer documentos es parte de la fase 2.
- **Los buckets se crean fuera de la aplicación.** En local lo hace el servicio `minio-init` de Docker Compose; en la nube, la infraestructura como código. La API no necesita permisos para crear buckets.
- **En local usamos `cgr.dev/chainguard/minio:latest`**, con las credenciales de root de MinIO para simplificar.

## Alternativas consideradas

- **El SDK de MinIO.** Funciona con otros servicios S3, pero acopla el código a un proveedor sin necesidad.
- **Sistema de archivos local.** Lo más simple, pero no sirve con varias réplicas ni en la nube sin volúmenes compartidos.
- **Guardar los archivos en PostgreSQL.** Infla la base de datos y sus backups, y mezcla datos calientes con binarios grandes.
- **Otro servidor S3 para desarrollo (SeaweedFS, Garage, RustFS, LocalStack).** Todos son reemplazos válidos. Nos quedamos con MinIO porque es el más conocido; si la imagen de Chainguard deja de estar disponible, cambiar de servidor no requiere tocar código.

## Consecuencias

- El mismo código funciona en local y en la nube.
- La etiqueta `latest` no es reproducible: dos personas pueden ejecutar versiones distintas de MinIO. Para desarrollo local lo aceptamos; en CI solo se usa para comprobar que el bucket responde.
- Las credenciales de root de MinIO solo son aceptables en local. En cualquier otro entorno la API debe usar credenciales limitadas a su bucket.

## Trade-offs

- Nos limitamos a lo que ofrece la API de S3. Funciones específicas de un proveedor (notificaciones de MinIO, eventos de S3) quedan fuera mientras no haya una necesidad clara.
- Revisaremos la elección del servidor local si la imagen de Chainguard deja de publicarse o cambia sus condiciones de uso.
