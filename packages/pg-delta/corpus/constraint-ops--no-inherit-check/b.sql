-- parent table with CHECK (FALSE) NO INHERIT plus an INHERITS child with its own PK
CREATE SCHEMA test_schema;

CREATE TABLE test_schema.parent_base (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  CONSTRAINT no_direct_insert CHECK (FALSE) NO INHERIT
);

CREATE TABLE test_schema.child (
  CONSTRAINT child_pkey PRIMARY KEY (id)
) INHERITS (test_schema.parent_base);
