package events

import (
	"bytes"
	"context"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/nats-io/nats.go/jetstream"
	"github.com/prometheus/client_golang/prometheus"

	"github.com/ricardoverita/verarag/apps/worker/internal/natstest"
	"github.com/ricardoverita/verarag/packages/contracts"
)

func startConsumer(t *testing.T, js jetstream.JetStream, logs *natstest.LogBuffer) (*Handler, jetstream.ConsumeContext) {
	t.Helper()
	validator, err := contracts.NewValidator()
	if err != nil {
		t.Fatal(err)
	}
	logger := slog.New(slog.NewJSONHandler(logs, nil))
	handler, err := NewHandler(validator, logger, prometheus.NewRegistry())
	if err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	consumeCtx, err := NewConsumer(js, handler, logger, 50*time.Millisecond).Start(ctx)
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	t.Cleanup(consumeCtx.Stop)
	return handler, consumeCtx
}

func publish(t *testing.T, js jetstream.JetStream, subject string, payload []byte) {
	t.Helper()
	if _, err := js.Publish(context.Background(), subject, payload); err != nil {
		t.Fatalf("publish: %v", err)
	}
}

func consumerInfo(t *testing.T, js jetstream.JetStream) *jetstream.ConsumerInfo {
	t.Helper()
	consumer, err := js.Consumer(context.Background(), contracts.StreamSystem, DurableName)
	if err != nil {
		t.Fatal(err)
	}
	info, err := consumer.Info(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	return info
}

func TestConsumerProcessesEventsFromTheStream(t *testing.T) {
	_, js := natstest.Start(t)
	natstest.CreateSystemStream(t, js)
	logs := &natstest.LogBuffer{}
	startConsumer(t, js, logs)

	publish(t, js, contracts.EventSystemTest, exampleEvent(t))

	natstest.Eventually(t, 5*time.Second, func() bool {
		return strings.Contains(logs.String(), `"msg":"system test event received"`)
	}, "the worker did not log the event")
	natstest.Eventually(t, 5*time.Second, func() bool {
		return consumerInfo(t, js).AckFloor.Stream == 1
	}, "the event was not acknowledged")
}

func TestConsumerTerminatesInvalidEvents(t *testing.T) {
	_, js := natstest.Start(t)
	natstest.CreateSystemStream(t, js)
	logs := &natstest.LogBuffer{}
	startConsumer(t, js, logs)

	invalid := bytes.Replace(exampleEvent(t), []byte(`"version": 1`), []byte(`"version": 9`), 1)
	publish(t, js, contracts.EventSystemTest, invalid)

	natstest.Eventually(t, 5*time.Second, func() bool {
		return strings.Contains(logs.String(), "rejecting event that does not match its contract")
	}, "the invalid event was not rejected")

	// Give JetStream a moment: a terminated message must not come back.
	time.Sleep(200 * time.Millisecond)
	info := consumerInfo(t, js)
	if info.NumAckPending != 0 || info.NumRedelivered != 0 {
		t.Errorf("invalid event is still pending: ack pending %d, redelivered %d", info.NumAckPending, info.NumRedelivered)
	}
	if strings.Count(logs.String(), "rejecting event") != 1 {
		t.Errorf("the invalid event was delivered more than once")
	}
}

func TestConsumerWaitsForTheStream(t *testing.T) {
	_, js := natstest.Start(t)
	logs := &natstest.LogBuffer{}

	// The API creates the stream; here it shows up a little after the worker starts.
	go func() {
		time.Sleep(200 * time.Millisecond)
		natstest.CreateSystemStream(t, js)
	}()
	startConsumer(t, js, logs)

	if !strings.Contains(logs.String(), "waiting for the stream") {
		t.Error("expected the consumer to log while it waits for the stream")
	}
}

func TestConsumerStopsWaitingWhenCancelled(t *testing.T) {
	_, js := natstest.Start(t)
	validator, _ := contracts.NewValidator()
	logger := slog.New(slog.DiscardHandler)
	handler, _ := NewHandler(validator, logger, prometheus.NewRegistry())

	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	_, err := NewConsumer(js, handler, logger, 50*time.Millisecond).Start(ctx)

	if err == nil {
		t.Fatal("expected an error when the stream never appears")
	}
}

func TestConsumerSharesWorkBetweenInstances(t *testing.T) {
	_, js := natstest.Start(t)
	natstest.CreateSystemStream(t, js)
	logsA, logsB := &natstest.LogBuffer{}, &natstest.LogBuffer{}
	startConsumer(t, js, logsA)
	startConsumer(t, js, logsB)

	for range 10 {
		publish(t, js, contracts.EventSystemTest, exampleEvent(t))
	}

	natstest.Eventually(t, 5*time.Second, func() bool {
		total := strings.Count(logsA.String(), "system test event received") +
			strings.Count(logsB.String(), "system test event received")
		return total == 10
	}, "each event should be handled exactly once across both instances")
}
