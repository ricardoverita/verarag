# syntax=docker/dockerfile:1
# Build from the repository root: docker build -f apps/worker/Dockerfile .

ARG GO_VERSION=1.27.2

FROM golang:${GO_VERSION}-alpine AS build
WORKDIR /src

# The worker imports packages/contracts through a replace directive.
COPY packages/contracts/go.mod packages/contracts/go.sum packages/contracts/
COPY apps/worker/go.mod apps/worker/go.sum apps/worker/
WORKDIR /src/apps/worker
RUN --mount=type=cache,target=/go/pkg/mod go mod download

COPY packages/contracts /src/packages/contracts
COPY apps/worker /src/apps/worker
ARG VERSION=dev
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -X main.version=${VERSION}" \
    -o /out/worker ./cmd/worker

# No shell or package manager in the runtime image; the binary implements
# its own healthcheck (`worker healthcheck`).
FROM gcr.io/distroless/static-debian13:nonroot
COPY --from=build /out/worker /usr/local/bin/worker
USER nonroot:nonroot
EXPOSE 8081
ENTRYPOINT ["/usr/local/bin/worker"]
