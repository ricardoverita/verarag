-- migrate:up

-- API keys for programmatic access. They belong to the organization, not to
-- the person who created them, so they keep working if that person leaves.
-- A key looks like vrg_<12 hex>_<43 base64url>: the first part is the public
-- prefix stored here to tell keys apart; the whole key is shown once and only
-- its SHA-256 is kept.
CREATE TABLE api_keys (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  name text NOT NULL,
  prefix text NOT NULL,
  key_hash bytea NOT NULL,
  scopes text[] NOT NULL,
  created_by_user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- NULL means the key does not expire.
  expires_at timestamptz,
  -- Updated at most every few minutes, not on every request.
  last_used_at timestamptz,
  revoked_at timestamptz,
  CONSTRAINT api_keys_prefix_key UNIQUE (prefix),
  CONSTRAINT api_keys_prefix_format CHECK (prefix ~ '^vrg_[0-9a-f]{12}$'),
  CONSTRAINT api_keys_key_hash_length CHECK (octet_length(key_hash) = 32),
  CONSTRAINT api_keys_name_length CHECK (char_length(btrim(name)) BETWEEN 1 AND 100),
  -- The scopes that exist today. New ones are added here on purpose.
  CONSTRAINT api_keys_scopes_known CHECK (
    cardinality(scopes) >= 1 AND scopes <@ ARRAY['system:read']::text[]
  ),
  CONSTRAINT api_keys_expiry_after_creation CHECK (expires_at IS NULL OR expires_at > created_at)
);

CREATE INDEX api_keys_organization_idx ON api_keys (organization_id, created_at DESC);

-- migrate:down

DROP TABLE api_keys;
