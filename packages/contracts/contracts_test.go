package contracts

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"
	"time"
)

func newValidator(t *testing.T) *Validator {
	t.Helper()
	validator, err := NewValidator()
	if err != nil {
		t.Fatalf("NewValidator: %v", err)
	}
	return validator
}

func readExample(t *testing.T, name string) []byte {
	t.Helper()
	raw, err := os.ReadFile("examples/" + name)
	if err != nil {
		t.Fatalf("read example: %v", err)
	}
	return raw
}

// decodeStrict fails when the JSON has fields the Go type does not know about,
// which is how we notice a schema change that the Go types missed.
func decodeStrict(t *testing.T, raw []byte, target any) {
	t.Helper()
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		t.Fatalf("decode %T: %v", target, err)
	}
}

func TestSharedExamplesAreValid(t *testing.T) {
	validator := newValidator(t)

	if err := validator.ValidateEvent(EventSystemTest, readExample(t, "events/system.test.json")); err != nil {
		t.Errorf("system.test example: %v", err)
	}
	if err := validator.ValidateWorkerHeartbeat(readExample(t, "status/worker-heartbeat.json")); err != nil {
		t.Errorf("worker heartbeat example: %v", err)
	}
}

func TestSharedExamplesDecodeIntoGoTypes(t *testing.T) {
	var envelope Envelope
	decodeStrict(t, readExample(t, "events/system.test.json"), &envelope)
	if envelope.Type != EventSystemTest || envelope.Version != 1 {
		t.Fatalf("unexpected envelope: %+v", envelope)
	}

	var data SystemTestData
	decodeStrict(t, envelope.Data, &data)
	if data.Message != "hello from VeraRAG" {
		t.Errorf("message = %q", data.Message)
	}

	var heartbeat WorkerHeartbeat
	decodeStrict(t, readExample(t, "status/worker-heartbeat.json"), &heartbeat)
	if heartbeat.InstanceID == "" || heartbeat.SentAt.IsZero() {
		t.Errorf("unexpected heartbeat: %+v", heartbeat)
	}
}

func TestGoTypesProduceValidPayloads(t *testing.T) {
	validator := newValidator(t)

	data, _ := json.Marshal(SystemTestData{Message: "hello"})
	event, _ := json.Marshal(Envelope{
		ID:         "6a1f3c2e-9b4d-4e8a-8f7c-1d2e3f4a5b6c",
		Type:       EventSystemTest,
		Version:    1,
		Source:     "worker",
		OccurredAt: time.Now().UTC(),
		Data:       data,
	})
	if err := validator.ValidateEvent(EventSystemTest, event); err != nil {
		t.Errorf("event built from Go types: %v", err)
	}

	heartbeat, _ := json.Marshal(WorkerHeartbeat{
		InstanceID: "worker-1",
		Version:    "dev",
		StartedAt:  time.Now().UTC(),
		SentAt:     time.Now().UTC(),
	})
	if err := validator.ValidateWorkerHeartbeat(heartbeat); err != nil {
		t.Errorf("heartbeat built from Go types: %v", err)
	}
}

func TestValidateEventRejectsInvalidPayloads(t *testing.T) {
	validator := newValidator(t)
	example := readExample(t, "events/system.test.json")

	cases := map[string]func(event map[string]any){
		"empty message":    func(e map[string]any) { e["data"] = map[string]any{"message": ""} },
		"missing message":  func(e map[string]any) { e["data"] = map[string]any{} },
		"missing id":       func(e map[string]any) { delete(e, "id") },
		"id is not a uuid": func(e map[string]any) { e["id"] = "not-a-uuid" },
		"bad timestamp":    func(e map[string]any) { e["occurredAt"] = "yesterday" },
		"wrong version":    func(e map[string]any) { e["version"] = 2 },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			var event map[string]any
			if err := json.Unmarshal(example, &event); err != nil {
				t.Fatal(err)
			}
			mutate(event)
			payload, _ := json.Marshal(event)

			err := validator.ValidateEvent(EventSystemTest, payload)
			var validationErr *ValidationError
			if !errors.As(err, &validationErr) {
				t.Fatalf("expected a ValidationError, got %v", err)
			}
		})
	}
}

func TestValidateEventReportsTheFailingField(t *testing.T) {
	validator := newValidator(t)
	payload := bytes.Replace(readExample(t, "events/system.test.json"),
		[]byte(`"hello from VeraRAG"`), []byte(`""`), 1)

	err := validator.ValidateEvent(EventSystemTest, payload)
	if err == nil || !strings.Contains(err.Error(), "/data/message") {
		t.Fatalf("expected an error that points at /data/message, got %v", err)
	}
}

func TestValidateEventRejectsMalformedJSON(t *testing.T) {
	var validationErr *ValidationError
	err := newValidator(t).ValidateEvent(EventSystemTest, []byte(`{"id":`))
	if !errors.As(err, &validationErr) {
		t.Fatalf("expected a ValidationError, got %v", err)
	}
}

func TestValidateEventWithUnknownType(t *testing.T) {
	err := newValidator(t).ValidateEvent("system.unknown", []byte(`{}`))
	if !errors.Is(err, ErrUnknownSchema) {
		t.Fatalf("expected ErrUnknownSchema, got %v", err)
	}
}
