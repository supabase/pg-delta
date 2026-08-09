-- replica identity is set to use the unique index; index definition widened (triggers DROP+CREATE+re-set)
CREATE SCHEMA test_schema;

CREATE TABLE test_schema.replicated (
  id integer NOT NULL,
  tenant_id integer NOT NULL,
  payload text
);

-- widened index: includes id column; still used as replica identity
CREATE UNIQUE INDEX replicated_tenant_id_key
  ON test_schema.replicated (tenant_id, id);

ALTER TABLE test_schema.replicated
  REPLICA IDENTITY USING INDEX replicated_tenant_id_key;
