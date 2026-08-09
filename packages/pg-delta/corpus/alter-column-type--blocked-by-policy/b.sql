CREATE SCHEMA t;
CREATE TYPE t.user_role_enum AS ENUM ('admin', 'user', 'guest');
-- role column retyped text -> enum; a policy references the column, so the
-- policy must be dropped before ALTER COLUMN TYPE and recreated after
CREATE TABLE t.cats (id integer PRIMARY KEY, name text NOT NULL, role t.user_role_enum NOT NULL);
ALTER TABLE t.cats ENABLE ROW LEVEL SECURITY;
CREATE POLICY cats_admin ON t.cats FOR ALL TO public
  USING (role = 'admin'::t.user_role_enum) WITH CHECK (role = 'admin'::t.user_role_enum);
