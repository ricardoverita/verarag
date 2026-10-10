#!/usr/bin/env bash
# End-to-end check of a running local stack (`docker compose up`):
#
#   1. the API is ready and every component reports healthy;
#   2. the auth flow works through the web app, as a browser uses it:
#      sign-up, sign-out, sign-in, a second organization, an invitation
#      accepted by a new user, members, and an API key created, used and
#      revoked;
#   3. documents work end to end through the web app: a collection, an
#      upload, its metadata and checksum, a byte-for-byte download with
#      safe headers, the object in a private bucket under an id-only key,
#      and a deletion that removes it;
#   4. another tenant cannot see any of it;
#   5. no password, session token, invitation token, API key or document
#      content reaches the logs;
#   6. an event published through POST /api/v1/dev/events reaches the
#      worker through NATS JetStream and shows up in its logs.
#
# CI runs it after `docker compose up --wait`. It needs curl, jq and Docker,
# and DEV_ENDPOINTS_ENABLED=true in .env. Sign-ups are limited to 5 every
# 10 minutes per client: run it at most twice in a row, or restart the api
# container.
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
MINIO_URL="${MINIO_URL:-http://127.0.0.1:$(env_value MINIO_PORT 9000)}"
BUCKET="$(env_value S3_BUCKET verarag-documents)"
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

workdir=$(mktemp -d)
trap 'rm -rf "$workdir"' EXIT

# call <client> <method> <path> [json]: a request to the web app's /api/v1
# proxy with the client's cookie jar, sent like a browser on the web app's
# origin would. Sets STATUS and BODY.
call() {
  local jar="$workdir/$1.cookies" method=$2 path=$3 data=${4:-}
  local args=(-sS -b "$jar" -c "$jar" -X "$method" -H "Origin: $WEB_URL"
    -H 'Accept: application/json' -o "$workdir/body" -w '%{http_code}')
  [[ -n "$data" ]] && args+=(-H 'Content-Type: application/json' -d "$data")
  STATUS=$(curl "${args[@]}" "$WEB_URL$path")
  BODY=$(cat "$workdir/body")
}

# expect <status> <what>: fails unless the last call answered <status>.
expect() {
  if [[ "$STATUS" != "$1" ]]; then
    if [[ "$STATUS" == "429" ]]; then
      fail "$2: rate limited. Wait 10 minutes or restart the api container."
    fi
    fail "$2: expected HTTP $1, got $STATUS: $BODY"
  fi
}

sha256_of() {
  if command -v sha256sum >/dev/null; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

# upload <client> <collection path> <file> <type>: a multipart upload through
# the web app, like the browser's. Sets STATUS and BODY.
upload() {
  local jar="$workdir/$1.cookies"
  STATUS=$(curl -sS -b "$jar" -c "$jar" -H "Origin: $WEB_URL" -F "file=@$3;type=$4" \
    -o "$workdir/body" -w '%{http_code}' "$WEB_URL$2/documents")
  BODY=$(cat "$workdir/body")
}

object_exists() {
  docker compose exec -T minio mc stat "local/$BUCKET/$1" >/dev/null 2>&1
}

session_token() {
  awk '$6 ~ /verarag_session$/ { print $7 }' "$workdir/$1.cookies" | tail -n 1
}

# Values that must never appear in the logs.
secrets=()

stamp="$(date +%s)-$RANDOM"
ana_email="smoke-ana-$stamp@example.com"
bruno_email="smoke-bruno-$stamp@example.com"
carla_email="smoke-carla-$stamp@example.com"
ana_password="smoke ana passphrase $stamp"
bruno_password="smoke bruno passphrase $stamp"
carla_password="smoke carla passphrase $stamp"
secrets+=("$ana_password" "$bruno_password" "$carla_password")

account() {
  jq -nc --arg email "$1" --arg password "$2" --arg name "$3" --arg organization "$4" \
    '{email: $email, password: $password, displayName: $name, organizationName: $organization}'
}

step "API readiness ($API_URL)"
retry "the API is not ready" curl -fsS -o /dev/null "$API_URL/health/ready"
echo "    ready"

step "Web app ($WEB_URL)"
curl -fsS -o /dev/null "$WEB_URL/health/live" || fail "the web app health endpoint does not answer"
page=$(curl -fsS "$WEB_URL/") || fail "the home page does not answer"
grep -q "System status" <<<"$page" || fail "the home page did not render the status panel"
echo "    home page rendered"

step "Sign-up"
curl -sS -D "$workdir/headers" -o /dev/null -c "$workdir/ana.cookies" -X POST \
  "$WEB_URL/api/v1/auth/register" -H "Origin: $WEB_URL" -H 'Content-Type: application/json' \
  -d "$(account "$ana_email" "$ana_password" "Ana" "Smoke Labs $stamp")"
set_cookie=$(grep -i '^set-cookie:.*verarag_session=' "$workdir/headers" || true)
[[ -n "$set_cookie" ]] || fail "sign-up did not set the session cookie"
grep -qi 'httponly' <<<"$set_cookie" || fail "the session cookie is not HttpOnly"
grep -qi 'samesite=lax' <<<"$set_cookie" || fail "the session cookie is not SameSite=Lax"
call ana GET /api/v1/auth/me
expect 200 "reading the new session"
labs=$(jq -r '.memberships[0].organization.id' <<<"$BODY")
[[ "$(jq -r '.memberships[0].role' <<<"$BODY")" == "OWNER" ]] || fail "the new user is not OWNER"
first_token=$(session_token ana)
secrets+=("$first_token")
echo "    $ana_email is OWNER of organization $labs; the cookie is HttpOnly and SameSite=Lax"

step "System status"
system_is_healthy() {
  call ana GET /api/v1/system/status
  [[ "$STATUS" == "200" ]] && jq -e '.status == "ok"' <<<"$BODY" >/dev/null
}
retry "not every component is healthy" system_is_healthy
jq -r '.components[] | "    \(.name): \(.status) \(.details // {} | tostring)"' <<<"$BODY"
status_code=$(curl -s -o /dev/null -w '%{http_code}' "$API_URL/api/v1/system/status")
[[ "$status_code" == "401" ]] || fail "the system status answered $status_code without a session"
echo "    without a session: 401"

step "Sign-out and sign-in"
call ana POST /api/v1/auth/logout
expect 204 "signing out"
status_code=$(curl -s -o /dev/null -w '%{http_code}' -H "Cookie: verarag_session=$first_token" \
  "$API_URL/api/v1/auth/me")
[[ "$status_code" == "401" ]] || fail "the session still works after signing out ($status_code)"
call ana POST /api/v1/auth/login "$(jq -nc --arg e "$ana_email" '{email: $e, password: "wrong password"}')"
expect 401 "signing in with a wrong password"
call ana POST /api/v1/auth/login "$(jq -nc --arg e "$ana_email" --arg p "$ana_password" '{email: $e, password: $p}')"
expect 200 "signing in"
secrets+=("$(session_token ana)")
echo "    the old session is revoked; a wrong password is refused; signed in again"

step "Cross-site requests"
status_code=$(curl -s -o /dev/null -w '%{http_code}' -b "$workdir/ana.cookies" -X POST \
  -H 'Origin: https://evil.example' -H 'Content-Type: application/json' \
  -d '{"name": "Forged"}' "$WEB_URL/api/v1/organizations")
[[ "$status_code" == "403" ]] || fail "a cross-site POST answered $status_code"
echo "    a POST from another origin is refused"

step "Second organization"
call ana POST /api/v1/organizations '{"name": "Smoke Research"}'
expect 201 "creating an organization"
research=$(jq -r '.organization.id' <<<"$BODY")
call ana GET /api/v1/organizations
expect 200 "listing organizations"
[[ "$(jq '.organizations | length' <<<"$BODY")" == "2" ]] || fail "Ana should belong to 2 organizations"
echo "    created $research; Ana belongs to 2 organizations"

step "Invitation"
call ana POST "/api/v1/organizations/$labs/invitations" \
  "$(jq -nc --arg e "$bruno_email" '{email: $e, role: "MEMBER"}')"
expect 201 "inviting Bruno"
invite_token=$(jq -r '.inviteUrl' <<<"$BODY" | sed 's|.*/invitations/||')
secrets+=("$invite_token")
call bruno POST /api/v1/invitations/preview "$(jq -nc --arg t "$invite_token" '{token: $t}')"
expect 200 "previewing the invitation"
call bruno POST /api/v1/invitations/register \
  "$(jq -nc --arg t "$invite_token" --arg p "$bruno_password" '{token: $t, password: $p, displayName: "Bruno"}')"
expect 201 "accepting the invitation with a new account"
secrets+=("$(session_token bruno)")
call bruno POST /api/v1/invitations/register \
  "$(jq -nc --arg t "$invite_token" --arg p "$bruno_password" '{token: $t, password: $p, displayName: "Bruno"}')"
expect 410 "reusing the invitation"
echo "    Bruno joined with the link, which then stopped working"

step "Members"
call bruno GET /api/v1/auth/me
expect 200 "reading Bruno's session"
[[ "$(jq -r '[.memberships[] | .organization.id + ":" + .role] | join(",")' <<<"$BODY")" == "$labs:MEMBER" ]] ||
  fail "Bruno should be MEMBER of Ana's organization only"
call bruno GET "/api/v1/organizations/$labs/members"
expect 200 "listing members"
[[ "$(jq -r '[.members[].role] | join(",")' <<<"$BODY")" == "OWNER,MEMBER" ]] ||
  fail "unexpected members: $BODY"
call bruno GET "/api/v1/organizations/$research"
expect 404 "Bruno reading the organization he was not invited to"
echo "    Bruno sees the 2 members of Ana's organization and nothing else"

step "API key"
call ana POST "/api/v1/organizations/$labs/api-keys" '{"name": "Smoke test"}'
expect 201 "creating an API key"
api_key=$(jq -r '.key' <<<"$BODY")
api_key_id=$(jq -r '.apiKey.id' <<<"$BODY")
secrets+=("$api_key")
call ana GET "/api/v1/organizations/$labs/api-keys"
grep -qF "$api_key" <<<"$BODY" && fail "the API key is listed after its creation"
for url in "$API_URL" "$WEB_URL"; do
  status_code=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $api_key" \
    "$url/api/v1/system/status")
  [[ "$status_code" == "200" ]] || fail "the API key did not work against $url ($status_code)"
done
call bruno POST "/api/v1/organizations/$labs/api-keys" '{"name": "Not allowed"}'
expect 403 "a MEMBER creating an API key"
call ana DELETE "/api/v1/organizations/$labs/api-keys/$api_key_id"
expect 204 "revoking the API key"
status_code=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $api_key" \
  "$API_URL/api/v1/system/status")
[[ "$status_code" == "401" ]] || fail "the revoked API key still answered $status_code"
echo "    created, used through the API and the web app, revoked"

step "Documents"
call ana POST "/api/v1/organizations/$labs/collections" '{"name": "Smoke manuals"}'
expect 201 "creating a collection"
collection="/api/v1/organizations/$labs/collections/$(jq -r '.id' <<<"$BODY")"
document_marker="smoke document content $stamp"
printf '# Smoke guide\n\n%s\n' "$document_marker" >"$workdir/guide.md"
secrets+=("$document_marker")

upload ana "$collection" "$workdir/guide.md" text/markdown
expect 201 "uploading a Markdown file"
guide_id=$(jq -r '.id' <<<"$BODY")
[[ "$(jq -r '.status' <<<"$BODY")" == "AVAILABLE" ]] || fail "the upload is not AVAILABLE: $BODY"
[[ "$(jq -r '.sha256' <<<"$BODY")" == "$(sha256_of "$workdir/guide.md")" ]] ||
  fail "the stored SHA-256 does not match the file"
[[ "$(jq -r '.sizeBytes' <<<"$BODY")" == "$(wc -c <"$workdir/guide.md" | tr -d ' ')" ]] ||
  fail "the stored size does not match the file"
call bruno GET "$collection/documents"
expect 200 "listing documents as a MEMBER"
[[ "$(jq -r '.documents[0].filename' <<<"$BODY")" == "guide.md" ]] || fail "the document is not listed"
upload bruno "$collection" "$workdir/guide.md" text/markdown
expect 403 "a MEMBER uploading a document"

key="organizations/$labs/documents/$guide_id/source"
object_exists "$key" || fail "the object is not in the bucket under $key"
status_code=$(curl -s -o /dev/null -w '%{http_code}' "$MINIO_URL/$BUCKET/$key")
[[ "$status_code" == "403" ]] || fail "the bucket answered $status_code to an anonymous read"

content="/api/v1/organizations/$labs/documents/$guide_id/content"
curl -sS -b "$workdir/bruno.cookies" -D "$workdir/download-headers" -o "$workdir/downloaded.md" \
  "$WEB_URL$content"
cmp -s "$workdir/guide.md" "$workdir/downloaded.md" || fail "the download differs from the upload"
grep -qi '^content-disposition: attachment' "$workdir/download-headers" ||
  fail "the download is not an attachment"
grep -qi '^x-content-type-options: nosniff' "$workdir/download-headers" ||
  fail "the download can be sniffed"
grep -qi "^content-security-policy: default-src 'none'; sandbox" "$workdir/download-headers" ||
  fail "the download is not sandboxed"

printf '<h1>Smoke</h1><script>alert(1)</script>\n' >"$workdir/page.html"
upload ana "$collection" "$workdir/page.html" text/html
expect 201 "uploading an HTML file"
page_id=$(jq -r '.id' <<<"$BODY")
curl -sS -b "$workdir/ana.cookies" -D "$workdir/html-headers" -o /dev/null \
  "$WEB_URL/api/v1/organizations/$labs/documents/$page_id/content"
grep -qi '^content-disposition: attachment; filename=page.html' "$workdir/html-headers" ||
  fail "uploaded HTML is not sent as an attachment"

printf 'MZ\x90\x00binary' >"$workdir/setup.exe"
upload ana "$collection" "$workdir/setup.exe" application/octet-stream
expect 415 "uploading an executable"

call ana DELETE "/api/v1/organizations/$labs/documents/$guide_id"
expect 204 "deleting the document"
object_exists "$key" && fail "the object is still in the bucket after the deletion"
call ana GET "$content"
expect 404 "downloading a deleted document"
echo "    uploaded, listed, checked (SHA-256, size, private bucket, id-only key), downloaded"
echo "    byte for byte as an attachment, refused an executable, deleted with its object"

step "Tenant isolation"
call carla POST /api/v1/auth/register "$(account "$carla_email" "$carla_password" "Carla" "Smoke Other $stamp")"
expect 201 "registering Carla"
secrets+=("$(session_token carla)")
for path in "" /members /invitations /api-keys /collections "/collections/${collection##*/}/documents" \
  "/documents/$page_id" "/documents/$page_id/content"; do
  call carla GET "/api/v1/organizations/$labs$path"
  expect 404 "Carla reading /organizations/<Ana's>$path"
done
call carla PATCH "/api/v1/organizations/$labs" '{"name": "Taken"}'
expect 404 "Carla renaming Ana's organization"
call carla DELETE "/api/v1/organizations/$labs/api-keys/$api_key_id"
expect 404 "Carla revoking Ana's API key"
call carla DELETE "/api/v1/organizations/$labs/documents/$page_id"
expect 404 "Carla deleting Ana's document"
upload carla "$collection" "$workdir/page.html" text/html
expect 404 "Carla uploading into Ana's collection"
call ana GET "/api/v1/organizations/$labs/documents/$page_id"
expect 200 "Ana's document after Carla's attempts"
echo "    every request about Ana's organization, documents included, answers 404 to Carla"

step "Secrets in the logs"
docker compose logs --no-color api web >"$workdir/logs" 2>&1
for secret in "${secrets[@]}"; do
  [[ -n "$secret" ]] || continue
  if grep -qF -- "$secret" "$workdir/logs"; then
    fail "a password, token, API key or document content appears in the logs"
  fi
done
echo "    none of the ${#secrets[@]} passwords, tokens, keys and document contents used appear in the logs"

step "Event flow: API -> NATS JetStream -> worker"
worker_log_line() {
  docker compose logs --no-log-prefix worker 2>/dev/null |
    jq -cR --arg id "$1" 'fromjson? | select(.msg == "system test event received" and .event_id == $id)'
}
worker_logged() {
  [[ -n "$(worker_log_line "$1")" ]]
}
request_id="smoke-$stamp"
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
