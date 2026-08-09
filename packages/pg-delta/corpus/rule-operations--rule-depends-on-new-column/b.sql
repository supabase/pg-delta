CREATE SCHEMA test_schema;
CREATE TABLE test_schema.accounts (
  id serial PRIMARY KEY,
  note text,
  flagged boolean
);
CREATE RULE prevent_flagged_insert AS
  ON INSERT TO test_schema.accounts
  WHERE (NEW.flagged)
  DO INSTEAD NOTHING;
