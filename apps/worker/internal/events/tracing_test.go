package events

import (
	"context"
	"strings"
	"testing"

	"github.com/nats-io/nats.go"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.opentelemetry.io/otel/trace"

	"github.com/ricardoverita/verarag/packages/contracts"
)

func TestHandleContinuesTheTraceFromTheAPI(t *testing.T) {
	recorder := tracetest.NewSpanRecorder()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(recorder))
	previousProvider, previousPropagator := otel.GetTracerProvider(), otel.GetTextMapPropagator()
	otel.SetTracerProvider(provider)
	otel.SetTextMapPropagator(propagation.TraceContext{})
	t.Cleanup(func() {
		otel.SetTracerProvider(previousProvider)
		otel.SetTextMapPropagator(previousPropagator)
	})

	f := newHandlerFixture(t)
	const traceID = "4bf92f3577b34da6a3ce929d0e0e4736"
	headers := nats.Header{}
	// The API writes the header in lowercase, as nats.js keeps names as given.
	headers.Set("traceparent", "00-"+traceID+"-00f067aa0ba902b7-01")
	msg := &fakeMessage{subject: contracts.EventSystemTest, data: exampleEvent(t), headers: headers}

	f.handler.Handle(context.Background(), msg)

	spans := recorder.Ended()
	if len(spans) != 1 {
		t.Fatalf("recorded %d spans, want 1", len(spans))
	}
	span := spans[0]
	if span.Name() != "process system.test" || span.SpanKind() != trace.SpanKindConsumer {
		t.Errorf("span = %q (%v)", span.Name(), span.SpanKind())
	}
	if got := span.SpanContext().TraceID().String(); got != traceID {
		t.Errorf("trace id = %s, want %s", got, traceID)
	}
	if got := span.Parent().SpanID().String(); got != "00f067aa0ba902b7" {
		t.Errorf("parent span id = %s", got)
	}
	if !strings.Contains(f.logs.String(), `"trace_id":"`+traceID+`"`) {
		t.Errorf("the event log does not carry the trace id:\n%s", f.logs.String())
	}
}
