DO $$ BEGIN CREATE ROLE corpus_adp_grantee NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE SCHEMA s;

-- Function created BEFORE the default privilege below, so it does NOT carry the
-- grant. The ADP is identical in a and b (no delta) but stays ACTIVE on the
-- target. Same signature, changed RETURN TYPE (int -> bigint): CREATE OR REPLACE
-- refuses that, so pg-delta-next demolishes (drop + recreate) s.f — and the
-- recreate must not let the fresh function acquire the default-privilege grant
-- the desired state does not have. A body-only change would alter in place
-- (CREATE OR REPLACE re-fires no default ACLs), so the return type is changed to
-- keep pinning the demolition + default-ACL hygiene path.
CREATE FUNCTION s.f() RETURNS bigint LANGUAGE sql AS 'SELECT 1';

ALTER DEFAULT PRIVILEGES IN SCHEMA s GRANT EXECUTE ON FUNCTIONS TO corpus_adp_grantee;
