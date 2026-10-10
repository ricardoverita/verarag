-- migrate:up

-- Metadata of the files stored in object storage. The content never enters
-- PostgreSQL. storage_status describes only the stored object; the
-- ingestion state of phase 3 will be a separate column.
--
--   UPLOADING -> AVAILABLE -> DELETING -> DELETED
--   UPLOADING -> FAILED    -> DELETING -> DELETED
--
-- The row is written before the first byte reaches storage, so any object
-- under organizations/ has a row that names it, whatever happens later.
CREATE TABLE documents (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  collection_id uuid NOT NULL,
  -- Shown to people and used in Content-Disposition, never as a path.
  original_filename text NOT NULL,
  -- Decided by the API from the extension and the content, not taken from
  -- the browser.
  media_type text NOT NULL,
  -- Known once the upload is complete.
  size_bytes bigint,
  sha256 text,
  -- Derived from ids only, so it can never contain anything a user chose.
  object_key text GENERATED ALWAYS AS (
    'organizations/' || organization_id::text || '/documents/' || id::text || '/source'
  ) STORED,
  storage_status text NOT NULL DEFAULT 'UPLOADING',
  failure_reason text,
  created_by_user_id uuid REFERENCES users (id) ON DELETE RESTRICT,
  created_by_api_key_id uuid REFERENCES api_keys (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  -- The collection must belong to the same organization as the document.
  CONSTRAINT documents_collection_fkey FOREIGN KEY (collection_id, organization_id)
    REFERENCES collections (id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT documents_filename_check CHECK (
    char_length(original_filename) BETWEEN 1 AND 255
    AND original_filename !~ '[[:cntrl:]/\\]'
  ),
  CONSTRAINT documents_media_type_check CHECK (media_type IN (
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/markdown',
    'text/plain',
    'text/html'
  )),
  CONSTRAINT documents_size_check CHECK (size_bytes IS NULL OR size_bytes >= 0),
  -- Lowercase hex, the format of sha256sum and most tools.
  CONSTRAINT documents_sha256_check CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT documents_storage_status_check CHECK (
    storage_status IN ('UPLOADING', 'AVAILABLE', 'FAILED', 'DELETING', 'DELETED')
  ),
  CONSTRAINT documents_failure_reason_check CHECK (
    failure_reason IN ('too_large', 'type_not_allowed', 'storage_error', 'interrupted')
  ),
  CONSTRAINT documents_failed_has_reason CHECK (
    storage_status <> 'FAILED' OR failure_reason IS NOT NULL
  ),
  CONSTRAINT documents_available_is_complete CHECK (
    storage_status <> 'AVAILABLE' OR (size_bytes IS NOT NULL AND sha256 IS NOT NULL)
  ),
  CONSTRAINT documents_deleted_at_check CHECK (
    (storage_status = 'DELETED') = (deleted_at IS NOT NULL)
  ),
  CONSTRAINT documents_created_by CHECK (
    num_nonnulls(created_by_user_id, created_by_api_key_id) = 1
  )
);

-- Listing a collection, newest first, and checking whether it is empty.
CREATE INDEX documents_collection_idx ON documents (collection_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- Finding documents stuck in a transient state, for recovery.
CREATE INDEX documents_pending_idx ON documents (storage_status, updated_at)
  WHERE storage_status IN ('UPLOADING', 'DELETING');

CREATE TRIGGER documents_set_updated_at BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- migrate:down

DROP TABLE documents;
