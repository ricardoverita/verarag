// Package heartbeat lets the API know which worker instances are alive.
//
// Each instance writes a small JSON document to a NATS key-value bucket
// whose entries expire after TTL. The API reads the bucket instead of
// calling the workers, so the two only meet through NATS.
package heartbeat

import (
	"context"
	"encoding/json"
	"log/slog"
	"time"

	"github.com/nats-io/nats.go/jetstream"

	"github.com/ricardoverita/verarag/packages/contracts"
)

const (
	// Interval between heartbeats.
	Interval = 10 * time.Second
	// TTL of an entry. A worker missing three heartbeats in a row is gone.
	TTL = 30 * time.Second
)

// Publisher writes heartbeats while the worker is ready to process events.
type Publisher struct {
	js       jetstream.JetStream
	logger   *slog.Logger
	interval time.Duration
	ready    func() bool
	value    contracts.WorkerHeartbeat
	kv       jetstream.KeyValue
}

// NewPublisher creates a publisher. ready decides whether a heartbeat is
// sent: a worker that cannot consume should not look healthy.
func NewPublisher(js jetstream.JetStream, logger *slog.Logger, instanceID, version string, ready func() bool) *Publisher {
	return &Publisher{
		js:       js,
		logger:   logger,
		interval: Interval,
		ready:    ready,
		value: contracts.WorkerHeartbeat{
			InstanceID: instanceID,
			Version:    version,
			StartedAt:  time.Now().UTC(),
		},
	}
}

// Run sends a heartbeat right away and then on every interval until ctx is
// cancelled. It is not safe to call Run and Remove concurrently.
func (p *Publisher) Run(ctx context.Context) {
	ticker := time.NewTicker(p.interval)
	defer ticker.Stop()

	p.beat(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			p.beat(ctx)
		}
	}
}

// Remove deletes this instance's entry so the API notices a clean shutdown
// right away instead of waiting for the TTL.
func (p *Publisher) Remove(ctx context.Context) error {
	if p.kv == nil {
		return nil
	}
	return p.kv.Delete(ctx, p.value.InstanceID)
}

func (p *Publisher) beat(ctx context.Context) {
	if !p.ready() {
		return
	}

	heartbeat := p.value
	heartbeat.SentAt = time.Now().UTC()
	payload, err := json.Marshal(heartbeat)
	if err != nil {
		p.logger.Error("could not encode heartbeat", "error", err)
		return
	}

	if err := p.put(ctx, heartbeat.InstanceID, payload); err != nil {
		// The bucket lives in memory, so it disappears when NATS restarts.
		// Create it again and retry once before giving up until the next beat.
		p.kv = nil
		if err := p.put(ctx, heartbeat.InstanceID, payload); err != nil {
			p.logger.Warn("could not send heartbeat", "error", err)
			p.kv = nil
		}
	}
}

func (p *Publisher) put(ctx context.Context, key string, payload []byte) error {
	if p.kv == nil {
		kv, err := p.js.CreateOrUpdateKeyValue(ctx, jetstream.KeyValueConfig{
			Bucket:      contracts.WorkerHeartbeatBucket,
			Description: "Heartbeats of the VeraRAG worker instances",
			TTL:         TTL,
			History:     1,
			Storage:     jetstream.MemoryStorage,
		})
		if err != nil {
			return err
		}
		p.kv = kv
	}
	_, err := p.kv.Put(ctx, key, payload)
	return err
}
