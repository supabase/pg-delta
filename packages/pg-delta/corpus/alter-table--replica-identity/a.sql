-- table with a unique index but replica identity is still DEFAULT
CREATE SCHEMA test_schema;

CREATE TABLE test_schema.replicated (
  id integer NOT NULL,
  tenant_id integer NOT NULL,
  payload text
);

CREATE UNIQUE INDEX replicated_tenant_id_key
  ON test_schema.replicated (tenant_id);
