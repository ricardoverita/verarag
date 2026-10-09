# syntax=docker/dockerfile:1
# Build from the repository root: docker build -f apps/api/Dockerfile .

ARG NODE_VERSION=24.21.0

FROM node:${NODE_VERSION}-alpine AS build
ENV pnpm_config_store_dir=/pnpm/store
RUN corepack enable
WORKDIR /repo

# Download dependencies from the lockfile alone, so this layer is reused
# until the lockfile changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch

COPY tsconfig.base.json ./
COPY packages/contracts packages/contracts
COPY apps/api apps/api
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --offline --frozen-lockfile --filter @verarag/api...
RUN pnpm --filter @verarag/api... build
# A self-contained copy of the API with production dependencies only.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm deploy --filter @verarag/api --prod --legacy /out

FROM node:${NODE_VERSION}-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 3001
CMD ["node", "dist/main.js"]
