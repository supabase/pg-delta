-- table and column exist but have no comments and no PK
CREATE SCHEMA test_schema;

CREATE TABLE test_schema.events (
  id integer,
  created_at timestamp without time zone NOT NULL,
  payload text,
  description text
);
