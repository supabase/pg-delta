-- state B: new role, new schema, new table, and a grant — all created together
-- exercises that CREATE ROLE/SCHEMA/TABLE are ordered before GRANT
DO $$ BEGIN CREATE ROLE corpus_dep_g NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA dep_s;
CREATE TABLE dep_s.dep_t (a int);
GRANT SELECT, UPDATE ON TABLE dep_s.dep_t TO corpus_dep_g;
