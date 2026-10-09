// Package telemetry sets up OpenTelemetry tracing for the worker.
package telemetry

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/nats-io/nats.go"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.43.0"
)

// Setup installs the W3C trace context propagator and, when endpoint is not
// empty, a tracer provider that exports spans over OTLP/HTTP. The exporter
// reads the standard OTEL_EXPORTER_OTLP_* variables.
//
// The propagator is always installed: even with tracing off, the worker
// logs the trace id it receives from the API, so logs can still be joined.
//
// The returned function flushes pending spans; call it on shutdown.
func Setup(ctx context.Context, endpoint, version string, logger *slog.Logger) (func(context.Context) error, error) {
	otel.SetTextMapPropagator(propagation.TraceContext{})
	if endpoint == "" {
		return func(context.Context) error { return nil }, nil
	}

	exporter, err := otlptracehttp.New(ctx)
	if err != nil {
		return nil, fmt.Errorf("create trace exporter: %w", err)
	}
	provider := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exporter),
		sdktrace.WithResource(resource.NewSchemaless(
			semconv.ServiceName("verarag-worker"),
			semconv.ServiceVersion(version),
		)),
	)
	otel.SetTracerProvider(provider)
	otel.SetErrorHandler(otel.ErrorHandlerFunc(func(err error) {
		logger.Warn("tracing error", "error", err)
	}))
	logger.Info("tracing enabled", "endpoint", endpoint)
	return provider.Shutdown, nil
}

// HeaderCarrier lets the propagator read and write NATS message headers.
// NATS header names are case-sensitive and the API writes them in lowercase,
// which is what the W3C propagator expects.
type HeaderCarrier nats.Header

// Get returns the first value of key.
func (c HeaderCarrier) Get(key string) string { return nats.Header(c).Get(key) }

// Set replaces the value of key.
func (c HeaderCarrier) Set(key, value string) { nats.Header(c).Set(key, value) }

// Keys lists the header names.
func (c HeaderCarrier) Keys() []string {
	keys := make([]string, 0, len(c))
	for key := range c {
		keys = append(keys, key)
	}
	return keys
}
