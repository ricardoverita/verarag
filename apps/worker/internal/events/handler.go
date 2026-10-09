// Package events consumes VeraRAG events from NATS JetStream.
package events

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
	"github.com/prometheus/client_golang/prometheus"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"

	"github.com/ricardoverita/verarag/apps/worker/internal/telemetry"
	"github.com/ricardoverita/verarag/packages/contracts"
)

// Message is the part of jetstream.Msg the handler needs. Keeping it small
// lets the tests use a fake message instead of a NATS server.
type Message interface {
	Subject() string
	Data() []byte
	Headers() nats.Header
	Metadata() (*jetstream.MsgMetadata, error)
	Ack() error
	NakWithDelay(delay time.Duration) error
	TermWithReason(reason string) error
}

// Processing outcomes, used in logs and metrics.
const (
	outcomeProcessed = "processed"
	outcomeRejected  = "rejected"
	outcomeFailed    = "failed"
)

// retryDelay is how long JetStream waits before redelivering a message whose
// handler failed. The consumer's MaxDeliver bounds the number of attempts.
const retryDelay = 5 * time.Second

// Handler validates incoming events against the shared contracts and
// dispatches them by type.
type Handler struct {
	validator *contracts.Validator
	logger    *slog.Logger
	tracer    trace.Tracer
	processed *prometheus.CounterVec
	duration  *prometheus.HistogramVec
}

// NewHandler creates a handler and registers its metrics.
func NewHandler(validator *contracts.Validator, logger *slog.Logger, registerer prometheus.Registerer) (*Handler, error) {
	h := &Handler{
		validator: validator,
		logger:    logger,
		tracer:    otel.Tracer("github.com/ricardoverita/verarag/apps/worker"),
		processed: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "verarag_worker_events_processed_total",
			Help: "Events received by the worker, by event type and outcome (processed, rejected or failed).",
		}, []string{"type", "outcome"}),
		duration: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Name:    "verarag_worker_event_processing_duration_seconds",
			Help:    "Time spent handling an event, from receipt to acknowledgement.",
			Buckets: prometheus.DefBuckets,
		}, []string{"type"}),
	}
	for _, collector := range []prometheus.Collector{h.processed, h.duration} {
		if err := registerer.Register(collector); err != nil {
			return nil, fmt.Errorf("register metrics: %w", err)
		}
	}
	return h, nil
}

// Handle processes one message and always settles it: ack when it was
// handled, term when retrying cannot help, nak when a retry might.
func (h *Handler) Handle(ctx context.Context, msg Message) {
	start := time.Now()

	// Continue the trace started by the API, if the message carries one.
	ctx = otel.GetTextMapPropagator().Extract(ctx, telemetry.HeaderCarrier(msg.Headers()))
	ctx, span := h.tracer.Start(ctx, "process "+msg.Subject(),
		trace.WithSpanKind(trace.SpanKindConsumer),
		trace.WithAttributes(
			attribute.String("messaging.system", "nats"),
			attribute.String("messaging.destination.name", msg.Subject()),
		),
	)
	defer span.End()

	eventType, outcome := h.process(ctx, msg)
	span.SetAttributes(attribute.String("verarag.outcome", outcome))
	if outcome != outcomeProcessed {
		span.SetStatus(codes.Error, outcome)
	}

	h.processed.WithLabelValues(eventType, outcome).Inc()
	h.duration.WithLabelValues(eventType).Observe(time.Since(start).Seconds())
}

func (h *Handler) process(ctx context.Context, msg Message) (eventType, outcome string) {
	subject := msg.Subject()
	logger := h.logger.With("subject", subject)
	if spanContext := trace.SpanContextFromContext(ctx); spanContext.IsValid() {
		logger = logger.With("trace_id", spanContext.TraceID().String(), "span_id", spanContext.SpanID().String())
	}
	if metadata, err := msg.Metadata(); err == nil {
		logger = logger.With("stream_sequence", metadata.Sequence.Stream, "delivery_attempt", metadata.NumDelivered)
	}

	if err := h.validator.ValidateEvent(subject, msg.Data()); err != nil {
		label := subject
		if errors.Is(err, contracts.ErrUnknownSchema) {
			// Unknown subjects are grouped so they cannot create unbounded metric labels.
			label = "unknown"
		}
		logger.Warn("rejecting event that does not match its contract", "error", err)
		h.term(logger, msg, "invalid event")
		return label, outcomeRejected
	}

	var envelope contracts.Envelope
	if err := json.Unmarshal(msg.Data(), &envelope); err != nil || envelope.Type != subject {
		logger.Warn("rejecting event whose type does not match its subject", "type", envelope.Type)
		h.term(logger, msg, "type does not match subject")
		return subject, outcomeRejected
	}

	logger = logger.With(
		"event_id", envelope.ID,
		"event_type", envelope.Type,
		"correlation_id", envelope.CorrelationID,
	)

	var err error
	switch envelope.Type {
	case contracts.EventSystemTest:
		err = h.handleSystemTest(ctx, logger, envelope)
	default:
		logger.Warn("no handler for this event type")
		h.term(logger, msg, "no handler")
		return envelope.Type, outcomeRejected
	}

	if err != nil {
		logger.Error("event handling failed, it will be retried", "error", err, "retry_in", retryDelay)
		if nakErr := msg.NakWithDelay(retryDelay); nakErr != nil {
			logger.Error("could not nak event", "error", nakErr)
		}
		return envelope.Type, outcomeFailed
	}

	if err := msg.Ack(); err != nil {
		// The work is done; JetStream will redeliver and the handler must
		// tolerate seeing the event again.
		logger.Error("could not ack event", "error", err)
	}
	return envelope.Type, outcomeProcessed
}

// handleSystemTest only logs the event. system.test exists to check that
// the API -> NATS -> worker path works end to end.
func (h *Handler) handleSystemTest(ctx context.Context, logger *slog.Logger, envelope contracts.Envelope) error {
	var data contracts.SystemTestData
	if err := json.Unmarshal(envelope.Data, &data); err != nil {
		return fmt.Errorf("decode system.test data: %w", err)
	}
	logger.InfoContext(ctx, "system test event received",
		"message", data.Message,
		"source", envelope.Source,
		"occurred_at", envelope.OccurredAt,
	)
	return nil
}

func (h *Handler) term(logger *slog.Logger, msg Message, reason string) {
	if err := msg.TermWithReason(reason); err != nil {
		logger.Error("could not terminate event", "error", err)
	}
}
