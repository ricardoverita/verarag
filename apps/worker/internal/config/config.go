// Package config reads and validates the worker configuration from the environment.
package config

import (
	"errors"
	"fmt"
	"log/slog"
	"net"
	"os"
	"regexp"
	"strings"
	"time"
)

// Config is the validated worker configuration.
type Config struct {
	NATSURL         string
	HTTPAddr        string
	LogLevel        slog.Level
	InstanceID      string
	ShutdownTimeout time.Duration
}

// Instance ids are used as keys in a NATS key-value bucket, which only
// accepts these characters.
var validInstanceID = regexp.MustCompile(`^[A-Za-z0-9_=.-]{1,128}$`)

var invalidInstanceIDChars = regexp.MustCompile(`[^A-Za-z0-9_=.-]`)

// Load reads the configuration through getenv, so tests can pass their own
// values. Every problem is reported at once.
func Load(getenv func(string) string) (Config, error) {
	cfg := Config{
		NATSURL:         valueOr(getenv("NATS_URL"), "nats://localhost:4222"),
		HTTPAddr:        valueOr(getenv("WORKER_HTTP_ADDR"), ":8081"),
		InstanceID:      getenv("WORKER_INSTANCE_ID"),
		ShutdownTimeout: 15 * time.Second,
	}
	var problems []error

	if err := cfg.LogLevel.UnmarshalText([]byte(valueOr(getenv("LOG_LEVEL"), "info"))); err != nil {
		problems = append(problems, fmt.Errorf("LOG_LEVEL: %w", err))
	}

	if _, _, err := net.SplitHostPort(cfg.HTTPAddr); err != nil {
		problems = append(problems, fmt.Errorf("WORKER_HTTP_ADDR: %w", err))
	}

	if raw := getenv("WORKER_SHUTDOWN_TIMEOUT"); raw != "" {
		timeout, err := time.ParseDuration(raw)
		switch {
		case err != nil:
			problems = append(problems, fmt.Errorf("WORKER_SHUTDOWN_TIMEOUT: %w", err))
		case timeout <= 0:
			problems = append(problems, errors.New("WORKER_SHUTDOWN_TIMEOUT: must be positive"))
		default:
			cfg.ShutdownTimeout = timeout
		}
	}

	if cfg.InstanceID == "" {
		cfg.InstanceID = defaultInstanceID()
	} else if !validInstanceID.MatchString(cfg.InstanceID) {
		problems = append(problems, errors.New("WORKER_INSTANCE_ID: only letters, digits, '-', '_', '=' and '.' are allowed (max 128)"))
	}

	if !strings.HasPrefix(cfg.NATSURL, "nats://") && !strings.HasPrefix(cfg.NATSURL, "tls://") {
		problems = append(problems, errors.New("NATS_URL: must start with nats:// or tls://"))
	}

	if len(problems) > 0 {
		return Config{}, fmt.Errorf("invalid configuration: %w", errors.Join(problems...))
	}
	return cfg, nil
}

// defaultInstanceID uses the hostname, which is the container id in Docker
// and the pod name in Kubernetes.
func defaultInstanceID() string {
	hostname, err := os.Hostname()
	if err != nil || hostname == "" {
		return "worker"
	}
	id := invalidInstanceIDChars.ReplaceAllString(hostname, "-")
	if len(id) > 128 {
		id = id[:128]
	}
	return id
}

func valueOr(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}
