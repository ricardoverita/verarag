package contracts

import (
	"bytes"
	"errors"
	"fmt"
	"io/fs"
	"strings"

	"github.com/santhosh-tekuri/jsonschema/v6"
	"golang.org/x/text/language"
	"golang.org/x/text/message"
)

// WorkerHeartbeatSchemaID is the id of the worker heartbeat schema.
const WorkerHeartbeatSchemaID = "urn:verarag:schema:status:worker-heartbeat"

// EventSchemaID returns the id of the schema for an event type. Every event
// schema follows this naming, which is how both languages find them.
func EventSchemaID(eventType string) string {
	return "urn:verarag:schema:events:" + eventType
}

// ErrUnknownSchema is returned when no schema is registered for an id.
var ErrUnknownSchema = errors.New("no schema registered with this id")

// ValidationError means the payload is well-formed JSON but does not match
// its schema.
type ValidationError struct {
	SchemaID string
	Issues   []string
}

func (e *ValidationError) Error() string {
	return fmt.Sprintf("payload does not match %s: %s", e.SchemaID, strings.Join(e.Issues, "; "))
}

// Validator validates payloads against the embedded schemas. It is safe for
// concurrent use.
type Validator struct {
	schemas map[string]*jsonschema.Schema
}

// NewValidator compiles every embedded schema.
func NewValidator() (*Validator, error) {
	compiler := jsonschema.NewCompiler()
	compiler.DefaultDraft(jsonschema.Draft2020)
	compiler.AssertFormat()

	var ids []string
	err := fs.WalkDir(Schemas, "schemas", func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() || !strings.HasSuffix(path, ".schema.json") {
			return nil
		}
		raw, err := Schemas.ReadFile(path)
		if err != nil {
			return err
		}
		doc, err := jsonschema.UnmarshalJSON(bytes.NewReader(raw))
		if err != nil {
			return fmt.Errorf("parse %s: %w", path, err)
		}
		id, err := schemaID(doc)
		if err != nil {
			return fmt.Errorf("%s: %w", path, err)
		}
		if err := compiler.AddResource(id, doc); err != nil {
			return fmt.Errorf("register %s: %w", path, err)
		}
		ids = append(ids, id)
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("load schemas: %w", err)
	}

	validator := &Validator{schemas: make(map[string]*jsonschema.Schema, len(ids))}
	for _, id := range ids {
		schema, err := compiler.Compile(id)
		if err != nil {
			return nil, fmt.Errorf("compile %s: %w", id, err)
		}
		validator.schemas[id] = schema
	}
	return validator, nil
}

// ValidateEvent validates a raw event against the schema of its type.
func (v *Validator) ValidateEvent(eventType string, payload []byte) error {
	return v.validate(EventSchemaID(eventType), payload)
}

// ValidateWorkerHeartbeat validates a raw worker heartbeat.
func (v *Validator) ValidateWorkerHeartbeat(payload []byte) error {
	return v.validate(WorkerHeartbeatSchemaID, payload)
}

func (v *Validator) validate(schemaID string, payload []byte) error {
	schema, ok := v.schemas[schemaID]
	if !ok {
		return fmt.Errorf("%w: %s", ErrUnknownSchema, schemaID)
	}
	instance, err := jsonschema.UnmarshalJSON(bytes.NewReader(payload))
	if err != nil {
		return &ValidationError{SchemaID: schemaID, Issues: []string{"invalid JSON: " + err.Error()}}
	}
	if err := schema.Validate(instance); err != nil {
		var validationErr *jsonschema.ValidationError
		if errors.As(err, &validationErr) {
			return &ValidationError{SchemaID: schemaID, Issues: issues(validationErr)}
		}
		return err
	}
	return nil
}

func schemaID(doc any) (string, error) {
	object, ok := doc.(map[string]any)
	if !ok {
		return "", errors.New("schema is not a JSON object")
	}
	id, ok := object["$id"].(string)
	if !ok || id == "" {
		return "", errors.New("schema has no $id")
	}
	return id, nil
}

// issues flattens a validation error into one line per failing value.
func issues(err *jsonschema.ValidationError) []string {
	if len(err.Causes) == 0 {
		return []string{"/" + strings.Join(err.InstanceLocation, "/") + " " + err.ErrorKind.LocalizedString(printer)}
	}
	var out []string
	for _, cause := range err.Causes {
		out = append(out, issues(cause)...)
	}
	return out
}

var printer = message.NewPrinter(language.English)
