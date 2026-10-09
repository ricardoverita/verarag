# ADR 0005: Un monorepo políglota con pnpm y módulos de Go

- Estado: aceptada
- Fecha: 2026-10-09

## Contexto

VeraRAG tiene tres aplicaciones (web en Next.js, API en NestJS, worker en Go) y un paquete de contratos compartido por TypeScript y Go. Muchos cambios cruzan esas fronteras: un evento nuevo toca el contrato, la API que lo publica y el worker que lo consume.

Al principio lo mantiene una sola persona y queremos que contribuir sea fácil: clonar, levantar y probar sin coordinar varios repositorios.

## Decisión

Un único repositorio:

```
apps/api            NestJS (paquete de pnpm)
apps/web            Next.js (paquete de pnpm)
apps/worker         Go (módulo propio)
packages/contracts  JSON Schemas + paquete de pnpm + módulo de Go
deployments/docker  configuración de Prometheus y Grafana
docs                arquitectura, ADR y roadmap
scripts             smoke test end-to-end
compose.yaml        entorno local
```

- **pnpm workspaces** para TypeScript. `pnpm -r` ya ejecuta los scripts en orden topológico, así que no usamos Turborepo ni Nx.
- **Un módulo de Go por componente.** El worker importa `packages/contracts` con una directiva `replace` en su `go.mod`, sin publicar versiones del módulo.
- `@verarag/contracts` se compila en su script `prepare` al instalar dependencias, y los scripts `lint`, `typecheck` y `test` de la raíz lo vuelven a compilar antes de ejecutarse. Así nunca se revisa la API o la web contra una versión vieja de los contratos.
- `compose.yaml` vive en la raíz para que `docker compose up` funcione sin parámetros. Cada Dockerfile vive junto a su aplicación y se construye con la raíz como contexto, porque necesita el workspace y los contratos.
- Un solo pipeline de CI valida todo en cada cambio.

## Alternativas consideradas

- **Un repositorio por servicio.** Versionado independiente, pero los contratos tendrían que publicarse como paquete npm y como módulo de Go etiquetado, y cada cambio de contrato serían varios pull requests coordinados. Es prematuro.
- **Nx o Turborepo.** Aportan caché y ejecución solo de lo afectado. Con tres paquetes, `pnpm -r` es suficiente; los añadiremos si el tiempo de CI lo justifica.
- **Bazel.** Muy potente para repositorios políglotas, pero su complejidad no se justifica a este tamaño.
- **`go.work` en la raíz.** Funciona para el editor, pero la directiva `replace` es más explícita y no necesita archivos adicionales en la build de Docker.

## Consecuencias

- Los cambios que cruzan componentes son atómicos y se revisan en un solo pull request.
- Los contratos se consumen desde el código fuente, sin publicar versiones.
- Para trabajar en todo el repositorio hacen falta Node.js, pnpm, Go y Docker. Para solo ejecutarlo basta con Docker.
- El contexto de build de Docker es la raíz del repositorio, así que `.dockerignore` tiene que mantenerse al día para no copiar `node_modules`, builds ni secretos.

## Trade-offs

- La CI ejecuta todo en cada cambio, aunque solo se haya tocado una aplicación. Hoy tarda pocos minutos; cuando deje de ser así añadiremos filtros por ruta o una herramienta de builds incrementales.
- Si algún componente necesita un ciclo de releases propio (por ejemplo, publicar un SDK), lo separaremos entonces.
