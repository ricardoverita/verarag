package events

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/nats-io/nats.go/jetstream"

	"github.com/ricardoverita/verarag/packages/contracts"
)

// DurableName identifies the worker's consumer on the SYSTEM stream. Every
// worker instance shares it, so each event is handled by one of them.
const DurableName = "worker-system"

// Consumer binds the worker's durable consumer to a stream owned by the API
// and feeds the messages to a Handler.
type Consumer struct {
	js            jetstream.JetStream
	handler       *Handler
	logger        *slog.Logger
	retryInterval time.Duration
}

// NewConsumer creates a consumer. retryInterval is how often it checks
// whether the stream exists while waiting for the API to create it.
func NewConsumer(js jetstream.JetStream, handler *Handler, logger *slog.Logger, retryInterval time.Duration) *Consumer {
	return &Consumer{js: js, handler: handler, logger: logger, retryInterval: retryInterval}
}

// Start waits until the stream exists, creates or updates the durable
// consumer and starts receiving messages. It returns when messages are
// flowing; stop them with the returned ConsumeContext.
func (c *Consumer) Start(ctx context.Context) (jetstream.ConsumeContext, error) {
	stream, err := c.waitForStream(ctx)
	if err != nil {
		return nil, err
	}

	consumer, err := stream.CreateOrUpdateConsumer(ctx, jetstream.ConsumerConfig{
		Durable:       DurableName,
		Description:   "VeraRAG worker: system events",
		FilterSubject: contracts.StreamSystemSubjects,
		DeliverPolicy: jetstream.DeliverAllPolicy,
		AckPolicy:     jetstream.AckExplicitPolicy,
		AckWait:       30 * time.Second,
		MaxDeliver:    5,
		MaxAckPending: 64,
	})
	if err != nil {
		return nil, fmt.Errorf("create consumer %s: %w", DurableName, err)
	}

	// Handlers keep running while the consumer drains during shutdown, so
	// they get a context that is not cancelled by the shutdown signal.
	handlerCtx := context.WithoutCancel(ctx)
	consumeCtx, err := consumer.Consume(
		func(msg jetstream.Msg) { c.handler.Handle(handlerCtx, msg) },
		jetstream.ConsumeErrHandler(func(_ jetstream.ConsumeContext, err error) {
			c.logger.Warn("consumer error", "consumer", DurableName, "error", err)
		}),
	)
	if err != nil {
		return nil, fmt.Errorf("start consuming: %w", err)
	}

	c.logger.Info("consuming events", "stream", contracts.StreamSystem, "consumer", DurableName)
	return consumeCtx, nil
}

func (c *Consumer) waitForStream(ctx context.Context) (jetstream.Stream, error) {
	for attempt := 1; ; attempt++ {
		stream, err := c.js.Stream(ctx, contracts.StreamSystem)
		if err == nil {
			return stream, nil
		}
		c.logger.Info("waiting for the stream, which the API creates on startup",
			"stream", contracts.StreamSystem, "attempt", attempt, "error", err)

		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(c.retryInterval):
		}
	}
}
