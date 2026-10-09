package server

import (
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/prometheus/client_golang/prometheus"
)

func get(t *testing.T, handler http.Handler, path string) (int, string) {
	t.Helper()
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, path, nil))
	body, _ := io.ReadAll(recorder.Body)
	return recorder.Code, string(body)
}

func TestProbes(t *testing.T) {
	var readyErr error
	srv := New(":0", prometheus.NewRegistry(), func() error { return readyErr })

	if code, _ := get(t, srv.Handler, "/healthz"); code != http.StatusOK {
		t.Errorf("/healthz = %d", code)
	}
	if code, _ := get(t, srv.Handler, "/readyz"); code != http.StatusOK {
		t.Errorf("/readyz while ready = %d", code)
	}

	readyErr = errors.New("not connected to NATS")
	code, body := get(t, srv.Handler, "/readyz")
	if code != http.StatusServiceUnavailable || !strings.Contains(body, "not connected to NATS") {
		t.Errorf("/readyz while not ready = %d %s", code, body)
	}

	// Liveness does not depend on readiness.
	if code, _ := get(t, srv.Handler, "/healthz"); code != http.StatusOK {
		t.Errorf("/healthz while not ready = %d", code)
	}
}

func TestMetrics(t *testing.T) {
	registry := prometheus.NewRegistry()
	counter := prometheus.NewCounter(prometheus.CounterOpts{Name: "test_total", Help: "test"})
	registry.MustRegister(counter)
	counter.Inc()

	code, body := get(t, New(":0", registry, func() error { return nil }).Handler, "/metrics")

	if code != http.StatusOK || !strings.Contains(body, "test_total 1") {
		t.Errorf("/metrics = %d %s", code, body)
	}
}
