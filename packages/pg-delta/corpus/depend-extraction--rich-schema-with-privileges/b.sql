-- Rich schema exercising many dependency branches: object deps (view→table),
-- ACLs, default privileges, and role membership. Validates ordering correctness
-- when all these edge types are present simultaneously.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'corpus_parent_role_dep') THEN
    CREATE ROLE corpus_parent_role_dep;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'corpus_dep_role_a') THEN
    CREATE ROLE corpus_dep_role_a;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'corpus_dep_role_b') THEN
    CREATE ROLE corpus_dep_role_b;
  END IF;
END $$;
CREATE SCHEMA dep_schema;
CREATE TABLE dep_schema.tab (id int);
CREATE VIEW dep_schema.vw AS SELECT * FROM dep_schema.tab;
CREATE SEQUENCE dep_schema.seq;
CREATE MATERIALIZED VIEW dep_schema.mv AS SELECT 1 AS x;
GRANT SELECT ON dep_schema.tab TO corpus_dep_role_a;
GRANT SELECT ON dep_schema.vw TO corpus_dep_role_b;
GRANT USAGE ON SEQUENCE dep_schema.seq TO corpus_dep_role_a;
GRANT corpus_parent_role_dep TO corpus_dep_role_b;
ALTER DEFAULT PRIVILEGES IN SCHEMA dep_schema GRANT SELECT ON TABLES TO corpus_dep_role_a;
