-- state B: table created in custom schema with default grants, then anon explicitly revoked
DO $$ BEGIN CREATE ROLE corpus_anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE corpus_authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE corpus_service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA app;
ALTER DEFAULT PRIVILEGES IN SCHEMA app
  GRANT ALL ON TABLES TO corpus_anon, corpus_authenticated, corpus_service_role;
CREATE TABLE app.user_data (
  id integer PRIMARY KEY,
  username text UNIQUE NOT NULL,
  email text
);
REVOKE ALL ON app.user_data FROM corpus_anon;
