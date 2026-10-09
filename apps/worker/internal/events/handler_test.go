package events

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/nats-io/nats.go/jetstream"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/testutil"

	"github.com/ricardoverita/verarag/packages/contracts"
)

// fakeMessage records how the handler settled it.
type fakeMessage struct {
	subject string
	data    []byte
	settled string
	reason  string
}

func (m *fakeMessage) Subject() string { return m.subject }
func (m *fakeMessage) Data() []byte    { return m.data }
func (m *fakeMessage) Metadata() (*jetstream.MsgMetadata, error) {
	return &jetstream.MsgMetadata{NumDelivered: 1}, nil
}
func (m *fakeMessage) Ack() error { m.settled = "ack"; return nil }
func (m *fakeMessage) NakWithDelay(time.Duration) error {
	m.settled = "nak"
	return nil
}
func (m *fakeMessage) TermWithReason(reason string) error {
	m.settled, m.reason = "term", reason
	return nil
}

type handlerFixture struct {
	handler  *Handler
	logs     *bytes.Buffer
	registry *prometheus.Registry
}

func newHandlerFixture(t *testing.T) handlerFixture {
	t.Helper()
	validator, err := contracts.NewValidator()
	if err != nil {
		t.Fatal(err)
	}
	logs := &bytes.Buffer{}
	registry := prometheus.NewRegistry()
	handler, err := NewHandler(validator, slog.New(slog.NewJSONHandler(logs, nil)), registry)
	if err != nil {
		t.Fatal(err)
	}
	return handlerFixture{handler: handler, logs: logs, registry: registry}
}

func (f handlerFixture) count(eventType, outcome string) float64 {
	return testutil.ToFloat64(f.handler.processed.WithLabelValues(eventType, outcome))
}

func exampleEvent(t *testing.T) []byte {
	t.Helper()
	raw, err := os.ReadFile("../../../../packages/contracts/examples/events/system.test.json")
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestHandleSystemTestEvent(t *testing.T) {
	f := newHandlerFixture(t)
	msg := &fakeMessage{subject: contracts.EventSystemTest, data: exampleEvent(t)}

	f.handler.Handle(context.Background(), msg)

	if msg.settled != "ack" {
		t.Fatalf("message was %q, want ack", msg.settled)
	}
	if got := f.count(contracts.EventSystemTest, outcomeProcessed); got != 1 {
		t.Errorf("processed counter = %v, want 1", got)
	}

	var entry map[string]any
	for line := range strings.Lines(f.logs.String()) {
		if strings.Contains(line, "system test event received") {
			if err := json.Unmarshal([]byte(line), &entry); err != nil {
				t.Fatal(err)
			}
		}
	}
	if entry == nil {
		t.Fatalf("no structured log for the event, got:\n%s", f.logs.String())
	}
	want := map[string]any{
		"event_id":       "0b8f6a4e-5c1d-4e2f-9a3b-7d6c5e4f3a2b",
		"event_type":     "system.test",
		"correlation_id": "5f2b9c1e-8d4a-4b6f-a1c3-e7d9f0b2a4c6",
		"message":        "hello from VeraRAG",
		"source":         "api",
	}
	for key, value := range want {
		if entry[key] != value {
			t.Errorf("log field %s = %v, want %v", key, entry[key], value)
		}
	}
}

func TestHandleRejectsInvalidEvents(t *testing.T) {
	f := newHandlerFixture(t)
	invalid := bytes.Replace(exampleEvent(t), []byte(`"hello from VeraRAG"`), []byte(`""`), 1)
	msg := &fakeMessage{subject: contracts.EventSystemTest, data: invalid}

	f.handler.Handle(context.Background(), msg)

	if msg.settled != "term" {
		t.Fatalf("message was %q, want term: retrying an invalid event cannot help", msg.settled)
	}
	if got := f.count(contracts.EventSystemTest, outcomeRejected); got != 1 {
		t.Errorf("rejected counter = %v, want 1", got)
	}
}

func TestHandleRejectsUnknownSubjects(t *testing.T) {
	f := newHandlerFixture(t)
	msg := &fakeMessage{subject: "system.unknown", data: []byte(`{}`)}

	f.handler.Handle(context.Background(), msg)

	if msg.settled != "term" {
		t.Fatalf("message was %q, want term", msg.settled)
	}
	if got := f.count("unknown", outcomeRejected); got != 1 {
		t.Errorf("unknown subjects must share one metric label, counter = %v", got)
	}
}

func TestHandleRejectsMalformedJSON(t *testing.T) {
	f := newHandlerFixture(t)
	msg := &fakeMessage{subject: contracts.EventSystemTest, data: []byte(`{"id":`)}

	f.handler.Handle(context.Background(), msg)

	if msg.settled != "term" {
		t.Fatalf("message was %q, want term", msg.settled)
	}
}
