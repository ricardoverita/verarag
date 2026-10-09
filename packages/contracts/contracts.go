// Package contracts holds the payloads that VeraRAG services exchange over NATS.
//
// The JSON Schemas under schemas/ are the source of truth. The TypeScript
// package that lives in this same directory reads the same files, so the API
// and the worker validate against exactly the same definitions.
package contracts

import (
	"embed"
	"encoding/json"
	"time"
)

// Schemas contains every JSON Schema shared with the TypeScript services.
//
//go:embed schemas
var Schemas embed.FS

// Event types. The type of an event is also the NATS subject it is published on.
const (
	EventSystemTest = "system.test"
)

// JetStream streams. The API creates them and owns their configuration; the
// worker only binds its consumers to them.
const (
	StreamSystem         = "SYSTEM"
	StreamSystemSubjects = "system.>"
)

// WorkerHeartbeatBucket is the key-value bucket where every worker instance
// writes its heartbeat.
const WorkerHeartbeatBucket = "worker-heartbeats"

// Envelope mirrors schemas/events/envelope.schema.json. Data is kept raw so
// each handler decodes it into the type that matches the event.
type Envelope struct {
	ID            string          `json:"id"`
	Type          string          `json:"type"`
	Version       int             `json:"version"`
	Source        string          `json:"source"`
	OccurredAt    time.Time       `json:"occurredAt"`
	CorrelationID string          `json:"correlationId,omitempty"`
	Data          json.RawMessage `json:"data"`
}

// SystemTestData is the data of a system.test event.
type SystemTestData struct {
	Message string `json:"message"`
}

// WorkerHeartbeat mirrors schemas/status/worker-heartbeat.schema.json.
type WorkerHeartbeat struct {
	InstanceID string    `json:"instanceId"`
	Version    string    `json:"version"`
	StartedAt  time.Time `json:"startedAt"`
	SentAt     time.Time `json:"sentAt"`
}
