CREATE SCHEMA t;
CREATE TYPE t.user_role_enum AS ENUM ('admin', 'user', 'guest');
CREATE TABLE t.cats (id integer PRIMARY KEY, name text NOT NULL, role text NOT NULL);
ALTER TABLE t.cats ENABLE ROW LEVEL SECURITY;
CREATE POLICY cats_admin ON t.cats FOR ALL TO public
  USING (role = 'admin') WITH CHECK (role = 'admin');
