-- migrate:up

-- Browser sessions. The token lives only in the user's HttpOnly cookie; the
-- database keeps its SHA-256, so a leaked backup cannot be replayed as a
-- valid session.
CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  -- Sessions are credentials that belong to the user and are useless without
  -- them, so this is the one reference that cascades.
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  -- Updated at most every few minutes, not on every request.
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT sessions_token_hash_key UNIQUE (token_hash),
  CONSTRAINT sessions_token_hash_length CHECK (octet_length(token_hash) = 32),
  CONSTRAINT sessions_expiry_after_creation CHECK (expires_at > created_at)
);

CREATE INDEX sessions_user_idx ON sessions (user_id) WHERE revoked_at IS NULL;
-- Counting active sessions for metrics without scanning revoked ones.
CREATE INDEX sessions_active_idx ON sessions (expires_at) WHERE revoked_at IS NULL;

-- migrate:down

DROP TABLE sessions;
