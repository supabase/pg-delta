-- table with a self-referencing FK (adjacency list / tree structure)
CREATE SCHEMA test_schema;

CREATE TABLE test_schema.categories (
  id integer PRIMARY KEY,
  name text NOT NULL,
  parent_id integer,
  CONSTRAINT categories_parent_fkey
    FOREIGN KEY (parent_id) REFERENCES test_schema.categories (id)
);
