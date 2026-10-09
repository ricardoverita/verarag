// Command worker is the VeraRAG data plane. Today it consumes the
// development events published by the API; document ingestion, chunking
// and embeddings will run here in later phases.
package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"

	"github.com/ricardoverita/verarag/apps/worker/internal/config"
	"github.com/ricardoverita/verarag/apps/worker/internal/events"
	"github.com/ricardoverita/verarag/apps/worker/internal/heartbeat"
	"github.com/ricardoverita/verarag/apps/worker/internal/server"
	"github.com/ricardoverita/verarag/apps/worker/internal/telemetry"
	"github.com/ricardoverita/verarag/packages/contracts"
)

// version is set at build time with -ldflags "-X main.version=...".
var version = "dev"

func main() {
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		os.Exit(healthcheck(os.Getenv))
	}
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "worker:", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load(os.Getenv)
	if err != nil {
		return err
	}

	logger := newLogger(os.Stdout, cfg.LogLevel).With(
		"service", "worker",
		"version", version,
		"instance", cfg.InstanceID,
	)
	slog.SetDefault(logger)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	shutdownTracing, err := telemetry.Setup(ctx, cfg.OTLPEndpoint, version, logger)
	if err != nil {
		return err
	}

	validator, err := contracts.NewValidator()
	if err != nil {
		return err
	}

	registry := prometheus.NewRegistry()
	registry.MustRegister(
		collectors.NewGoCollector(),
		collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}),
	)
	handler, err := events.NewHandler(validator, logger, registry)
	if err != nil {
		return err
	}

	natsClosed := make(chan struct{})
	nc, err := connectNATS(cfg.NATSURL, logger, natsClosed)
	if err != nil {
		return err
	}
	defer nc.Close()

	var consuming atomic.Bool
	ready := func() error {
		if !nc.IsConnected() {
			return errors.New("not connected to NATS")
		}
		if !consuming.Load() {
			return errors.New("not consuming events yet")
		}
		return nil
	}

	httpServer := server.New(cfg.HTTPAddr, registry, ready)
	httpErrors := make(chan error, 1)
	go func() {
		logger.Info("http server listening", "addr", cfg.HTTPAddr)
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			httpErrors <- err
		}
	}()

	js, err := jetstream.New(nc)
	if err != nil {
		return fmt.Errorf("jetstream: %w", err)
	}

	consumeCtx, err := events.NewConsumer(js, handler, logger, 3*time.Second).Start(ctx)
	if err != nil && !errors.Is(err, context.Canceled) {
		return err
	}

	heartbeats := heartbeat.NewPublisher(js, logger, cfg.InstanceID, version, func() bool { return ready() == nil })
	heartbeatsDone := make(chan struct{})
	if consumeCtx != nil {
		consuming.Store(true)
		go func() {
			defer close(heartbeatsDone)
			heartbeats.Run(ctx)
		}()
	} else {
		close(heartbeatsDone)
	}

	select {
	case <-ctx.Done():
	case err := <-httpErrors:
		return fmt.Errorf("http server: %w", err)
	}

	logger.Info("shutting down", "timeout", cfg.ShutdownTimeout.String())
	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer cancel()

	// Stop taking new events and let the ones in progress finish.
	consuming.Store(false)
	if consumeCtx != nil {
		consumeCtx.Drain()
		select {
		case <-consumeCtx.Closed():
		case <-shutdownCtx.Done():
			logger.Warn("timed out waiting for events in progress; JetStream will redeliver them")
		}
	}

	<-heartbeatsDone
	if err := heartbeats.Remove(shutdownCtx); err != nil {
		logger.Warn("could not remove heartbeat", "error", err)
	}

	if err := nc.Drain(); err == nil {
		select {
		case <-natsClosed:
		case <-shutdownCtx.Done():
		}
	}

	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		logger.Warn("http server shutdown", "error", err)
	}

	if err := shutdownTracing(shutdownCtx); err != nil {
		logger.Warn("could not flush traces", "error", err)
	}

	logger.Info("worker stopped")
	return nil
}

func connectNATS(url string, logger *slog.Logger, closed chan<- struct{}) (*nats.Conn, error) {
	nc, err := nats.Connect(url,
		nats.Name("verarag-worker"),
		// Keep retrying in the background instead of failing at startup;
		// readiness reports the worker as not ready until it connects.
		nats.RetryOnFailedConnect(true),
		nats.MaxReconnects(-1),
		nats.ReconnectWait(2*time.Second),
		nats.ConnectHandler(func(nc *nats.Conn) {
			logger.Info("connected to NATS", "server", nc.ConnectedUrlRedacted())
		}),
		nats.DisconnectErrHandler(func(_ *nats.Conn, err error) {
			if err != nil {
				logger.Warn("disconnected from NATS", "error", err)
			}
		}),
		nats.ReconnectHandler(func(nc *nats.Conn) {
			logger.Info("reconnected to NATS", "server", nc.ConnectedUrlRedacted())
		}),
		nats.ClosedHandler(func(*nats.Conn) { close(closed) }),
	)
	if err != nil {
		return nil, fmt.Errorf("connect to NATS: %w", err)
	}
	return nc, nil
}

// newLogger writes JSON logs with the same base fields as the API: time
// (UTC), level (lowercase) and msg.
func newLogger(w io.Writer, level slog.Level) *slog.Logger {
	return slog.New(slog.NewJSONHandler(w, &slog.HandlerOptions{
		Level: level,
		ReplaceAttr: func(groups []string, attr slog.Attr) slog.Attr {
			if len(groups) > 0 {
				return attr
			}
			switch attr.Key {
			case slog.TimeKey:
				attr.Value = slog.TimeValue(attr.Value.Time().UTC())
			case slog.LevelKey:
				attr.Value = slog.StringValue(strings.ToLower(attr.Value.String()))
			}
			return attr
		},
	}))
}

// healthcheck backs the Docker healthcheck. The runtime image has no shell
// or curl, so the binary checks its own readiness endpoint.
func healthcheck(getenv func(string) string) int {
	addr := getenv("WORKER_HTTP_ADDR")
	if addr == "" {
		addr = ":8081"
	}
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		fmt.Fprintln(os.Stderr, "healthcheck:", err)
		return 1
	}
	if host == "" || host == "0.0.0.0" || host == "::" {
		host = "127.0.0.1"
	}

	client := http.Client{Timeout: 3 * time.Second}
	resp, err := client.Get("http://" + net.JoinHostPort(host, port) + "/readyz")
	if err != nil {
		fmt.Fprintln(os.Stderr, "healthcheck:", err)
		return 1
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		fmt.Fprintln(os.Stderr, "healthcheck: status", resp.StatusCode)
		return 1
	}
	return 0
}
