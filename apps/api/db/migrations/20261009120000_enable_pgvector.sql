-- migrate:up
-- pgvector provides the vector type and similarity operators. No table uses
-- it yet: the first embeddings arrive in phase 4.
CREATE EXTENSION IF NOT EXISTS vector;

-- migrate:down
DROP EXTENSION IF EXISTS vector;
