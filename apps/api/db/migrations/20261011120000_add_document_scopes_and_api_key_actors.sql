-- migrate:up

-- API keys can now read and write collections and documents. Existing keys
-- keep exactly the scopes they had; nothing is granted to them.
ALTER TABLE api_keys DROP CONSTRAINT api_keys_scopes_known;
ALTER TABLE api_keys ADD CONSTRAINT api_keys_scopes_known CHECK (
  cardinality(scopes) >= 1 AND scopes <@ ARRAY[
    'system:read',
    'collections:read',
    'collections:write',
    'documents:read',
    'documents:write'
  ]::text[]
);

-- Actions taken with an API key are attributed to the key, not to a person.
ALTER TABLE audit_events
  ADD COLUMN actor_api_key_id uuid REFERENCES api_keys (id) ON DELETE RESTRICT;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_single_actor CHECK (
  num_nonnulls(actor_user_id, actor_api_key_id) <= 1
);

-- migrate:down

ALTER TABLE audit_events DROP CONSTRAINT audit_events_single_actor;
ALTER TABLE audit_events DROP COLUMN actor_api_key_id;
ALTER TABLE api_keys DROP CONSTRAINT api_keys_scopes_known;
ALTER TABLE api_keys ADD CONSTRAINT api_keys_scopes_known CHECK (
  cardinality(scopes) >= 1 AND scopes <@ ARRAY['system:read']::text[]
);
