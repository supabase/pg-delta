CREATE SCHEMA test_schema;

CREATE TABLE test_schema.items (id integer, name text);

CREATE INDEX idx_items_name ON test_schema.items (name);

COMMENT ON INDEX test_schema.idx_items_name IS 'items name index';
