-- table with a PK, an extra column, and comments on table/column/constraint
CREATE SCHEMA test_schema;

CREATE TABLE test_schema.events (
  id integer,
  created_at timestamp without time zone NOT NULL,
  payload text,
  description text
);

ALTER TABLE test_schema.events ADD CONSTRAINT events_pkey PRIMARY KEY (id);

COMMENT ON TABLE test_schema.events IS 'This is a test table';
COMMENT ON COLUMN test_schema.events.created_at IS 'This is a created_at column';
COMMENT ON CONSTRAINT events_pkey ON test_schema.events IS 'This is a test constraint';
COMMENT ON COLUMN test_schema.events.description IS 'This is a description column';
