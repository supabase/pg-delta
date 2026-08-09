CREATE SCHEMA mgmt;
CREATE FUNCTION mgmt.is_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
CREATE SCHEMA app;
CREATE TABLE app.docs (id integer PRIMARY KEY, body text);
-- a policy AND a view, both referencing the unchanged managed function:
-- the old engine got stuck here (managed schema excluded from the apply
-- set); the new engine plans against a target that has mgmt.is_admin().
ALTER TABLE app.docs ENABLE ROW LEVEL SECURITY;
CREATE POLICY docs_admin ON app.docs FOR ALL USING (mgmt.is_admin());
CREATE VIEW app.admin_docs AS SELECT id FROM app.docs WHERE mgmt.is_admin();
