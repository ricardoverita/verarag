// Package natstest runs an in-process NATS server with JetStream for tests,
// so consumer tests do not depend on Docker.
package natstest

import (
	"bytes"
	"context"
	"sync"
	"testing"
	"time"

	"github.com/nats-io/nats-server/v2/server"
	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"

	"github.com/ricardoverita/verarag/packages/contracts"
)

// Start runs a JetStream-enabled server on a random port and returns a
// client connected to it. Both are shut down when the test ends.
func Start(t *testing.T) (*nats.Conn, jetstream.JetStream) {
	t.Helper()

	srv, err := server.NewServer(&server.Options{
		Host:      "127.0.0.1",
		Port:      server.RANDOM_PORT,
		JetStream: true,
		StoreDir:  t.TempDir(),
		NoLog:     true,
		NoSigs:    true,
	})
	if err != nil {
		t.Fatalf("start NATS server: %v", err)
	}
	go srv.Start()
	if !srv.ReadyForConnections(10 * time.Second) {
		t.Fatal("NATS server did not start")
	}
	t.Cleanup(srv.Shutdown)

	nc, err := nats.Connect(srv.ClientURL())
	if err != nil {
		t.Fatalf("connect to NATS: %v", err)
	}
	t.Cleanup(nc.Close)

	js, err := jetstream.New(nc)
	if err != nil {
		t.Fatalf("jetstream: %v", err)
	}
	return nc, js
}

// CreateSystemStream creates the SYSTEM stream the way the API does on startup.
func CreateSystemStream(t *testing.T, js jetstream.JetStream) {
	t.Helper()
	_, err := js.CreateStream(context.Background(), jetstream.StreamConfig{
		Name:     contracts.StreamSystem,
		Subjects: []string{contracts.StreamSystemSubjects},
		Storage:  jetstream.FileStorage,
	})
	if err != nil {
		t.Fatalf("create stream: %v", err)
	}
}

// LogBuffer collects log output written from several goroutines.
type LogBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *LogBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *LogBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

// Eventually retries check until it returns true or the timeout expires.
func Eventually(t *testing.T, timeout time.Duration, check func() bool, message string) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if check() {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal(message)
}
