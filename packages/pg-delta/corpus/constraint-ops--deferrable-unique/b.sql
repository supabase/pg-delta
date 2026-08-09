CREATE SCHEMA test_schema;
CREATE TABLE test_schema.items (id integer PRIMARY KEY, code text NOT NULL);
ALTER TABLE test_schema.items
  ADD CONSTRAINT uq_items_code UNIQUE (code) DEFERRABLE INITIALLY DEFERRED;
