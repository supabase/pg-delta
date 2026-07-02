DO $$ BEGIN CREATE ROLE corpus_fn_owner NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE SCHEMA s;

-- Same signature, changed BODY -> pg-delta-next replaces (drop + recreate) the
-- function. The recreate must re-establish the owner (unchanged owner has no
-- link/unlink delta, so it is otherwise reset to the applying role).
CREATE FUNCTION s.f() RETURNS int LANGUAGE sql AS 'SELECT 2';
ALTER FUNCTION s.f() OWNER TO corpus_fn_owner;
