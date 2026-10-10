# ADR 0008: Sesiones opacas en PostgreSQL y límites de tasa en memoria

- Estado: aceptada
- Fecha: 2026-10-10

## Contexto

La fase 1 añade cuentas con email y contraseña. Necesitamos decidir cómo se guardan las contraseñas, cómo se representa una sesión del navegador, cómo se cierra y cómo se frenan los ataques de fuerza bruta. Hoy la API corre como una sola instancia, Redis está provisionado pero ningún servicio lo usa y la web llama a la API desde su servidor.

Requisitos que pesan:

- Cerrar sesión tiene que invalidar la sesión de verdad, en el servidor, en el momento.
- Una copia filtrada de la base de datos no puede servir para entrar.
- Nada de lo que viaja al navegador debe poder leerse desde JavaScript.

## Decisión

**Contraseñas.** Argon2id con el módulo `crypto` de Node.js 24, sin dependencias nativas. Parámetros: 64 MiB de memoria, 3 pasadas, paralelismo 1, sal de 16 bytes y hash de 32 bytes, en formato PHC (`$argon2id$v=19$m=65536,t=3,p=1$…`). Superan el mínimo que recomienda OWASP (19 MiB, 2 pasadas) y tardan unos 100–180 ms por hash en un portátil actual. Si los parámetros cambian, el hash se actualiza en el siguiente login correcto. Para un email desconocido se verifica contra un hash ficticio, así la respuesta tarda lo mismo exista o no la cuenta. Política: entre 12 y 128 caracteres, sin reglas de composición (NIST SP 800-63B).

**Sesiones.** Un token opaco de 256 bits aleatorios en una cookie. En la tabla `sessions` se guarda solo su SHA-256, con su usuario, caducidad (`SESSION_TTL_HOURS`, 7 días por defecto), último uso y fecha de revocación. Un hash rápido basta porque el token no se puede adivinar; Argon2 solo tiene sentido para secretos que eligen las personas.

- La cookie es `HttpOnly`, `SameSite=Lax` y `Path=/`. En producción es `Secure` y usa el prefijo `__Host-`, que obliga al navegador a ligarla al host exacto. `SESSION_COOKIE_SECURE=false` está prohibido con `APP_ENV=production`.
- Cerrar sesión marca la fila como revocada. Cada login, registro o alta por invitación crea un token nuevo y revoca el que traía el navegador, así un id plantado antes de entrar no sirve después (_session fixation_).
- `last_seen_at` se actualiza como mucho cada 5 minutos, no en cada petición.

**CSRF.** `SameSite=Lax` impide que otros sitios envíen la cookie en un POST. Además, la API rechaza los métodos no seguros cuyo `Origin` no sea el de la web (`WEB_PUBLIC_URL`), y el proxy `/api/v1` de la web exige que `Origin` coincida con el host, igual que Next.js hace con las Server Actions.

**Límites de tasa.** En memoria, dentro de la API:

- `@nestjs/throttler` por IP: 120 peticiones por minuto en general; 5 registros cada 10 minutos; 10 logins por minuto; 20 previsualizaciones, 10 aceptaciones y 5 altas por invitación por minuto o cada 10 minutos según el caso.
- Un contador por email bloquea el login durante 15 minutos tras 5 fallos seguidos, venga de la IP que venga.

La IP del cliente sale de `X-Forwarded-For` solo cuando el proxy que lo añade está en `TRUST_PROXY`.

## Alternativas consideradas

- **JWT firmados sin estado.** Ahorran una consulta por petición, pero no se pueden revocar sin una lista de bloqueo, que es justo el estado que querían evitar. Exponen claims al cliente y hay que rotar claves. Para un único servicio que ya habla con PostgreSQL en cada petición, la ventaja no compensa.
- **Sesiones en Redis.** Más rápidas y con expiración nativa, pero Redis entraría en el camino crítico de la autenticación: si se cae, nadie puede entrar, y habría que asegurarlo, persistirlo y respaldarlo como una base de datos más. Con una sola instancia, PostgreSQL ya está en el camino de cada petición.
- **bcrypt o scrypt.** bcrypt trunca las contraseñas a 72 bytes y no es resistente a GPU como Argon2id. scrypt sería aceptable; Argon2id es la recomendación actual y Node.js 24 lo trae de serie.
- **Un proveedor gestionado (Auth0, Clerk, Supabase Auth, Keycloak).** Quedan fuera del alcance de esta fase. El camino hacia SSO está en el [ADR 0009](0009-local-credentials-first-oidc-later.md).

## Consecuencias

- Cada petición autenticada hace una consulta indexada por `token_hash`. Revocar es inmediato.
- Los límites de tasa viven en la memoria de cada proceso: con varias réplicas, cada una lleva su propia cuenta, y reiniciar la API los pone a cero.
- Sin un proxy delante que sobrescriba `X-Forwarded-For`, un cliente puede enviar esa cabecera a través de la web y elegir la IP que ve la API, lo que debilita los límites por IP. El bloqueo por email no depende de la IP.
- Hashear contraseñas cuesta CPU y 64 MiB por operación. El límite de registros y logins acota cuánto se puede forzar.

## Trade-offs

Elegimos la opción más fácil de razonar y de revocar a costa de una consulta por petición y de límites que no se comparten entre réplicas. Revisaremos la decisión cuando:

- la API corra con más de una réplica: los límites y el bloqueo por email pasarán a Redis, sin que las sesiones dejen PostgreSQL;
- la consulta de sesión aparezca como cuello de botella medido: entonces una caché corta en Redis, con la revocación propagada.
