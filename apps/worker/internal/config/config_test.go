package config

import (
	"log/slog"
	"strings"
	"testing"
	"time"
)

func env(values map[string]string) func(string) string {
	return func(key string) string { return values[key] }
}

func TestLoadDefaults(t *testing.T) {
	cfg, err := Load(env(nil))
	if err != nil {
		t.Fatalf("Load: %v", err)
	}

	if cfg.NATSURL != "nats://localhost:4222" {
		t.Errorf("NATSURL = %q", cfg.NATSURL)
	}
	if cfg.HTTPAddr != ":8081" {
		t.Errorf("HTTPAddr = %q", cfg.HTTPAddr)
	}
	if cfg.LogLevel != slog.LevelInfo {
		t.Errorf("LogLevel = %v", cfg.LogLevel)
	}
	if cfg.ShutdownTimeout != 15*time.Second {
		t.Errorf("ShutdownTimeout = %v", cfg.ShutdownTimeout)
	}
	if !validInstanceID.MatchString(cfg.InstanceID) {
		t.Errorf("default InstanceID %q is not a valid key", cfg.InstanceID)
	}
}

func TestLoadReadsEnvironment(t *testing.T) {
	cfg, err := Load(env(map[string]string{
		"NATS_URL":                "nats://nats:4222",
		"WORKER_HTTP_ADDR":        "127.0.0.1:9000",
		"LOG_LEVEL":               "debug",
		"WORKER_INSTANCE_ID":      "worker-1",
		"WORKER_SHUTDOWN_TIMEOUT": "5s",
	}))
	if err != nil {
		t.Fatalf("Load: %v", err)
	}

	want := Config{
		NATSURL:         "nats://nats:4222",
		HTTPAddr:        "127.0.0.1:9000",
		LogLevel:        slog.LevelDebug,
		InstanceID:      "worker-1",
		ShutdownTimeout: 5 * time.Second,
	}
	if cfg != want {
		t.Errorf("Load() = %+v, want %+v", cfg, want)
	}
}

func TestLoadReportsEveryProblem(t *testing.T) {
	_, err := Load(env(map[string]string{
		"NATS_URL":                "http://nats:4222",
		"WORKER_HTTP_ADDR":        "8081",
		"LOG_LEVEL":               "verbose",
		"WORKER_INSTANCE_ID":      "worker 1",
		"WORKER_SHUTDOWN_TIMEOUT": "-1s",
	}))
	if err == nil {
		t.Fatal("expected an error")
	}

	for _, variable := range []string{"NATS_URL", "WORKER_HTTP_ADDR", "LOG_LEVEL", "WORKER_INSTANCE_ID", "WORKER_SHUTDOWN_TIMEOUT"} {
		if !strings.Contains(err.Error(), variable) {
			t.Errorf("error does not mention %s: %v", variable, err)
		}
	}
}
