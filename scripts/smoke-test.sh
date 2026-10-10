#!/usr/bin/env bash
# End-to-end check of a running local stack (`docker compose up`):
#
#   1. the API is ready and every component reports healthy;
#   2. the web app answers;
#   3. an event published through POST /api/v1/dev/events reaches the
#      worker through NATS JetStream and shows up in its logs.
#
# CI runs it after `docker compose up --wait`. It needs curl, jq and Docker,
# and DEV_ENDPOINTS_ENABLED=true in .env.
set -euo pipefail

cd "$(dirname "$0")/.."

# Reads a value from .env, falling back to a default.
env_value() {
  local value=""
  if [[ -f .env ]]; then
    value=$(grep -E "^$1=" .env | tail -n 1 | cut -d= -f2- || true)
  fi
  echo "${value:-$2}"
}

API_URL="${API_URL:-http://127.0.0.1:$(env_value API_PORT 3001)}"
WEB_URL="${WEB_URL:-http://127.0.0.1:$(env_value WEB_PORT 3000)}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-60}"

step() { printf '\n==> %s\n' "$*"; }
fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

# retry <message> <command...>: runs the command every 2 seconds until it
# succeeds, or fails with <message> once TIMEOUT_SECONDS have passed.
retry() {
  local message=$1
  shift
  local deadline=$((SECONDS + TIMEOUT_SECONDS))
  until "$@"; do
    ((SECONDS < deadline)) || fail "$message (waited ${TIMEOUT_SECONDS}s)"
    sleep 2
  done
}

worker_log_line() {
  docker compose logs --no-log-prefix worker 2>/dev/null |
    jq -cR --arg id "$1" 'fromjson? | select(.msg == "system test event received" and .event_id == $id)'
}

worker_logged() {
  [[ -n "$(worker_log_line "$1")" ]]
}

step "API readiness ($API_URL)"
retry "the API is not ready" curl -fsS -o /dev/null "$API_URL/health/ready"
echo "    ready"

step "Sign-in"
cookies=$(mktemp)
trap 'rm -f "$cookies"' EXIT
smoke_email="smoke-$(date +%s)-$RANDOM@example.com"
curl -fsS -o /dev/null -c "$cookies" -X POST "$API_URL/api/v1/auth/register" \
  -H 'Content-Type: application/json' \
  -d "{\"email\": \"$smoke_email\", \"password\": \"smoke test password\", \"displayName\": \"Smoke Test\", \"organizationName\": \"Smoke Test\"}" ||
  fail "could not register a user"
echo "    registered $smoke_email"

step "System status"
system_is_healthy() {
  curl -fsS -b "$cookies" "$API_URL/api/v1/system/status" | jq -e '.status == "ok"' >/dev/null 2>&1
}
retry "not every component is healthy" system_is_healthy
curl -fsS -b "$cookies" "$API_URL/api/v1/system/status" |
  jq -r '.components[] | "    \(.name): \(.status) \(.details // {} | tostring)"'
status_code=$(curl -s -o /dev/null -w '%{http_code}' "$API_URL/api/v1/system/status")
[[ "$status_code" == "401" ]] || fail "the system status answered $status_code without a session"
echo "    without a session: 401"

step "Web app ($WEB_URL)"
curl -fsS -o /dev/null "$WEB_URL/health/live" || fail "the web app health endpoint does not answer"
page=$(curl -fsS "$WEB_URL/") || fail "the home page does not answer"
grep -q "System status" <<<"$page" || fail "the home page did not render the status panel"
echo "    home page rendered"

step "Event flow: API -> NATS JetStream -> worker"
request_id="smoke-$(date +%s)-$RANDOM"
response=$(curl -fsS -X POST "$API_URL/api/v1/dev/events" \
  -H 'Content-Type: application/json' \
  -H "X-Request-Id: $request_id" \
  -d '{"type": "system.test", "message": "smoke test"}') ||
  fail "could not publish the event; is DEV_ENDPOINTS_ENABLED=true in .env?"
event_id=$(jq -r '.id' <<<"$response")
echo "    published $event_id (request $request_id)"

retry "the worker did not log event $event_id" worker_logged "$event_id"
line=$(worker_log_line "$event_id")
[[ "$(jq -r '.correlation_id' <<<"$line")" == "$request_id" ]] ||
  fail "the worker logged the event without the request id as correlation id"
echo "    worker log: $line"

printf '\nAll checks passed.\n'
