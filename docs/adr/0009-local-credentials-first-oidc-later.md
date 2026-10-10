# ADR 0009: Credenciales propias primero, OIDC después

- Estado: aceptada
- Fecha: 2026-10-10

## Contexto

Las organizaciones que adopten VeraRAG querrán entrar con su proveedor de identidad (Microsoft Entra ID, Google Workspace, Okta, Keycloak...) mediante OpenID Connect. Pero la fase 1 tiene que dejar algo que funcione con `docker compose up`, sin cuentas en servicios externos, y el modelo de organizaciones, membresías e invitaciones es el mismo con o sin SSO.

## Decisión

La fase 1 implementa solo cuentas locales: email y contraseña ([ADR 0008](0008-sessions-in-postgresql.md)). No se integra ningún proveedor de identidad, ni gestionado ni self-hosted.

El modelo queda preparado para añadir OIDC sin rehacerlo:

- **La sesión no depende de cómo se entró.** Un login por OIDC terminará igual que uno con contraseña: llamando al mismo servicio que crea la sesión opaca y revoca la anterior. Las organizaciones, roles, invitaciones y API keys no cambian.
- **Identidades separadas del usuario.** Cuando llegue OIDC habrá una tabla `identities` (`user_id`, `provider`, `subject`, con `(provider, subject)` único). Un usuario podrá tener contraseña, una o varias identidades externas, o ambas. `users.password_hash` pasará a ser opcional en esa migración.
- **Configuración por organización.** Cada organización podrá registrar su proveedor (issuer, client id, secreto cifrado) y, opcionalmente, exigirlo a sus miembros. El vínculo con una cuenta se hará por `subject`, no por email, y la primera vez a través de una invitación o de un dominio verificado. Nunca se unirá una cuenta existente solo porque el proveedor devuelve el mismo email.
- **Flujo.** Authorization Code con PKCE, `state` y `nonce`, validando el ID token (firma, `iss`, `aud`, `exp`). La librería candidata es [`openid-client`](https://github.com/panva/openid-client), que está certificada por la OpenID Foundation.

## Alternativas consideradas

- **Empezar directamente con OIDC.** Obligaría a configurar un proveedor para probar cualquier cosa, y el modelo de tenants seguiría siendo el mismo trabajo.
- **Delegar la identidad en un servicio (Keycloak, Auth0, Clerk, Supabase Auth, Firebase Auth).** Ahorra código de autenticación, pero añade un servicio que operar o un tercero por el que pasan todos los logins. Para un proyecto self-hosted, sería una dependencia pesada desde el primer día. Keycloak seguirá siendo una opción como proveedor OIDC más, no como parte obligatoria.
- **SAML.** Algunos clientes lo pedirán. Se evaluará después de OIDC, que cubre a la mayoría de proveedores actuales.

## Consecuencias

- Hoy cada organización depende de que sus miembros gestionen bien sus contraseñas. No hay MFA, ni verificación de email, ni recuperación de contraseña: son trabajo pendiente y están listados en [SECURITY.md](../../SECURITY.md).
- El código de contraseñas (hash, verificación, límites) es nuestro y hay que mantenerlo.
- Añadir OIDC será una migración aditiva y un módulo nuevo, sin cambios en la tenencia.

## Trade-offs

Elegimos poder probar el producto completo en local, sin terceros, a costa de no ofrecer SSO todavía. Revisaremos el orden si una organización que quiera adoptar VeraRAG necesita SSO como condición para empezar.
