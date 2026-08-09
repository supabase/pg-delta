CREATE SCHEMA test_schema;
CREATE TABLE test_schema.documents (
  document_id uuid NOT NULL,
  file_name text NOT NULL,
  tenant_id uuid NOT NULL,
  PRIMARY KEY (document_id, tenant_id)
) PARTITION BY LIST (tenant_id);
CREATE TABLE test_schema.documents_default
  PARTITION OF test_schema.documents DEFAULT;
CREATE TABLE test_schema.documents_paxafe
  PARTITION OF test_schema.documents
  FOR VALUES IN ('019b8184-fa49-4a46-b429-4fe4cd9b1a8a');
ALTER TABLE test_schema.documents
  ADD CONSTRAINT documents_file_name_check
  CHECK (char_length(file_name) <= 255);
