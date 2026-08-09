-- state B: unrelated drop_s.old_t is gone (schema drop_s remains empty),
-- and a new role + new schema + new table + GRANT are all created together.
-- a->b must DROP the unrelated table while CREATE+GRANTing the new objects in one plan;
-- b->a does the reverse.
CREATE SCHEMA drop_s;
DO $$ BEGIN CREATE ROLE corpus_r_mix NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA dep_mix;
CREATE TABLE dep_mix.t (a int);
GRANT SELECT ON TABLE dep_mix.t TO corpus_r_mix;
