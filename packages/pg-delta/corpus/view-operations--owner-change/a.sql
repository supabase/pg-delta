DO $$ BEGIN CREATE ROLE corpus_view_previous_owner LOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE SCHEMA test_schema;

CREATE TABLE test_schema.users (
  id integer,
  name text
);

CREATE VIEW test_schema.owned_view AS
  SELECT id, name FROM test_schema.users;

ALTER VIEW test_schema.owned_view OWNER TO corpus_view_previous_owner;
