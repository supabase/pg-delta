-- code column retyped from app.code_old to app.code_new; both are user domains
-- over text, one present per state, so the plan creates code_new + drops
-- code_old around the ALTER COLUMN … TYPE.
CREATE SCHEMA app;

CREATE DOMAIN app.code_new AS text;

CREATE TABLE app.items (
  id integer PRIMARY KEY,
  code app.code_new NOT NULL
);
