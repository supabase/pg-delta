CREATE SCHEMA s;

CREATE TABLE s.tenants (
  id bigint PRIMARY KEY,
  external_id text NOT NULL
);

-- A STANDALONE unique index (not a UNIQUE constraint). An FK below references it.
-- pg_constraint.conindid on the FK points at this index, so a filter that excludes
-- "any index referenced by a constraint's conindid" wrongly drops it from extraction.
CREATE UNIQUE INDEX tenants_external_id_index ON s.tenants (external_id);

CREATE TABLE s.extensions (
  id bigint PRIMARY KEY,
  tenant_external_id text
);

ALTER TABLE s.extensions
  ADD CONSTRAINT extensions_tenant_external_id_fkey
  FOREIGN KEY (tenant_external_id) REFERENCES s.tenants (external_id) ON DELETE CASCADE;
