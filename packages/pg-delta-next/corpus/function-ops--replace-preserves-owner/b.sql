DO $$ BEGIN CREATE ROLE corpus_fn_owner NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE SCHEMA s;

-- Same signature, changed RETURN TYPE (int -> bigint). CREATE OR REPLACE refuses
-- a return-type change, so pg-delta-next demolishes (drop + recreate) the
-- function. The recreate must re-establish the owner (an unchanged owner has no
-- link/unlink delta, so it is otherwise reset to the applying role). A body-only
-- change would take the CREATE OR REPLACE alter path (owner preserved, nothing
-- to re-establish), so this scenario changes the return type to keep pinning the
-- demolition + owner re-establish path.
CREATE FUNCTION s.f() RETURNS bigint LANGUAGE sql AS 'SELECT 1';
ALTER FUNCTION s.f() OWNER TO corpus_fn_owner;
