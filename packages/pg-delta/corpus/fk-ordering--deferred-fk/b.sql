-- FK with DEFERRABLE INITIALLY DEFERRED (allows circular inserts within a transaction)
CREATE SCHEMA test_schema;

CREATE TABLE test_schema.parent (
  id integer PRIMARY KEY,
  name text NOT NULL
);

CREATE TABLE test_schema.child (
  id integer PRIMARY KEY,
  parent_id integer,
  name text NOT NULL,
  CONSTRAINT child_parent_fkey
    FOREIGN KEY (parent_id) REFERENCES test_schema.parent (id)
    DEFERRABLE INITIALLY DEFERRED
);
