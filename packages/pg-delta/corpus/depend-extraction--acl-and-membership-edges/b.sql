-- Schema with ACL and role membership edges, used to stress ordering of
-- privilege grants relative to the objects and roles they reference.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'corpus_dep_r1') THEN
    CREATE ROLE corpus_dep_r1;
  END IF;
END $$;
CREATE SCHEMA corpus_s1;
CREATE TABLE corpus_s1.t1 (a int);
GRANT SELECT ON corpus_s1.t1 TO corpus_dep_r1;
