-- migrate:up

-- Collections group the documents of an organization. They are created by a
-- person or by an API key, never both.
CREATE TABLE collections (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  -- Trimmed, NFC-normalized and with single spaces, done by the API.
  name text NOT NULL,
  description text,
  created_by_user_id uuid REFERENCES users (id) ON DELETE RESTRICT,
  created_by_api_key_id uuid REFERENCES api_keys (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Deleted collections stay as history: their documents keep pointing at them.
  deleted_at timestamptz,
  -- Lets documents reference (collection, organization) together, so the
  -- database itself refuses a document whose collection is in another
  -- organization.
  CONSTRAINT collections_id_organization_key UNIQUE (id, organization_id),
  CONSTRAINT collections_name_length CHECK (
    name = btrim(name) AND char_length(name) BETWEEN 1 AND 100
  ),
  CONSTRAINT collections_description_length CHECK (
    description IS NULL OR char_length(description) BETWEEN 1 AND 1000
  ),
  CONSTRAINT collections_created_by CHECK (
    num_nonnulls(created_by_user_id, created_by_api_key_id) = 1
  )
);

-- One live collection per name and organization, ignoring case. It also
-- serves listing an organization's collections.
CREATE UNIQUE INDEX collections_name_key ON collections (organization_id, lower(name))
  WHERE deleted_at IS NULL;

CREATE TRIGGER collections_set_updated_at BEFORE UPDATE ON collections
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- migrate:down

DROP TABLE collections;
