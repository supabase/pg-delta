-- "mgmt" stands in for a managed schema (auth/storage): present on both
-- sides, unchanged, so it never enters the diff — but user objects in "app"
-- reference it, and the plan applies to a target that already has it.
CREATE SCHEMA mgmt;
CREATE FUNCTION mgmt.is_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
CREATE SCHEMA app;
CREATE TABLE app.docs (id integer PRIMARY KEY, body text);
