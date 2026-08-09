-- column typed by a user domain that only exists in this state; the type is
-- created/dropped in the same plan as the ALTER COLUMN … TYPE, so the alter
-- must consume the new type (run after its CREATE) and release the old type
-- (run before its DROP).
CREATE SCHEMA app;

CREATE DOMAIN app.code_old AS text;

CREATE TABLE app.items (
  id integer PRIMARY KEY,
  code app.code_old NOT NULL
);
