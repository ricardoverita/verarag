package heartbeat

import (
	"context"
	"errors"
	"log/slog"
	"testing"
	"time"

	"github.com/nats-io/nats.go/jetstream"

	"github.com/ricardoverita/verarag/apps/worker/internal/natstest"
	"github.com/ricardoverita/verarag/packages/contracts"
)

func readHeartbeat(t *testing.T, js jetstream.JetStream, key string) (jetstream.KeyValueEntry, error) {
	t.Helper()
	kv, err := js.KeyValue(context.Background(), contracts.WorkerHeartbeatBucket)
	if err != nil {
		return nil, err
	}
	return kv.Get(context.Background(), key)
}

func TestPublisherWritesAValidHeartbeat(t *testing.T) {
	_, js := natstest.Start(t)
	publisher := NewPublisher(js, slog.New(slog.DiscardHandler), "worker-1", "1.2.3", func() bool { return true })

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { defer close(done); publisher.Run(ctx) }()

	var entry jetstream.KeyValueEntry
	natstest.Eventually(t, 5*time.Second, func() bool {
		var err error
		entry, err = readHeartbeat(t, js, "worker-1")
		return err == nil
	}, "no heartbeat was written")

	validator, err := contracts.NewValidator()
	if err != nil {
		t.Fatal(err)
	}
	if err := validator.ValidateWorkerHeartbeat(entry.Value()); err != nil {
		t.Errorf("heartbeat does not match the contract the API reads: %v", err)
	}

	kv, _ := js.KeyValue(context.Background(), contracts.WorkerHeartbeatBucket)
	status, _ := kv.Status(context.Background())
	if status.TTL() != TTL {
		t.Errorf("bucket TTL = %v, want %v", status.TTL(), TTL)
	}

	cancel()
	<-done
	if err := publisher.Remove(context.Background()); err != nil {
		t.Fatalf("Remove: %v", err)
	}
	if _, err := readHeartbeat(t, js, "worker-1"); !errors.Is(err, jetstream.ErrKeyNotFound) {
		t.Errorf("heartbeat still present after Remove: %v", err)
	}
}

func TestPublisherStaysQuietWhileNotReady(t *testing.T) {
	_, js := natstest.Start(t)
	publisher := NewPublisher(js, slog.New(slog.DiscardHandler), "worker-1", "1.2.3", func() bool { return false })

	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	publisher.Run(ctx)

	if _, err := readHeartbeat(t, js, "worker-1"); err == nil {
		t.Error("a worker that is not ready must not send heartbeats")
	}
}

func TestPublisherRecreatesTheBucketAfterItDisappears(t *testing.T) {
	_, js := natstest.Start(t)
	publisher := NewPublisher(js, slog.New(slog.DiscardHandler), "worker-1", "1.2.3", func() bool { return true })
	ctx := context.Background()

	publisher.beat(ctx)
	// What a NATS restart does to a bucket kept in memory.
	if err := js.DeleteKeyValue(ctx, contracts.WorkerHeartbeatBucket); err != nil {
		t.Fatal(err)
	}
	publisher.beat(ctx)

	if _, err := readHeartbeat(t, js, "worker-1"); err != nil {
		t.Fatalf("heartbeat was not written again: %v", err)
	}
}
