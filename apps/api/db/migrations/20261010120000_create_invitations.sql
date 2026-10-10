-- migrate:up

-- Invitations to join an organization. Like sessions, only the SHA-256 of the
-- token is stored: the link with the token is shown once to whoever creates
-- the invitation and cannot be recovered from the database.
CREATE TABLE invitations (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  -- Normalized like users.email. Only that email can accept the invitation.
  email text NOT NULL,
  role text NOT NULL,
  token_hash bytea NOT NULL,
  invited_by_user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  accepted_by_user_id uuid REFERENCES users (id) ON DELETE RESTRICT,
  revoked_at timestamptz,
  CONSTRAINT invitations_token_hash_key UNIQUE (token_hash),
  CONSTRAINT invitations_token_hash_length CHECK (octet_length(token_hash) = 32),
  CONSTRAINT invitations_email_normalized CHECK (
    email = lower(btrim(email)) AND char_length(email) BETWEEN 3 AND 254 AND position('@' IN email) > 1
  ),
  CONSTRAINT invitations_role_check CHECK (role IN ('OWNER', 'ADMIN', 'MEMBER', 'VIEWER')),
  CONSTRAINT invitations_expiry_after_creation CHECK (expires_at > created_at),
  -- Single use: an invitation ends either accepted or revoked, never both.
  CONSTRAINT invitations_single_outcome CHECK (accepted_at IS NULL OR revoked_at IS NULL),
  CONSTRAINT invitations_accepted_by CHECK ((accepted_at IS NULL) = (accepted_by_user_id IS NULL))
);

-- At most one open invitation per email and organization. Inviting the same
-- email again revokes the previous one, so an old link stops working. Expired
-- invitations count as open here, because an index cannot depend on now().
CREATE UNIQUE INDEX invitations_open_key ON invitations (organization_id, email)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

-- migrate:down

DROP TABLE invitations;
