DO $$ BEGIN CREATE ROLE corpus_adp_grantee NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE SCHEMA s;

-- Function created BEFORE the default privilege below, so it does NOT carry the
-- grant. The ADP is identical in a and b (no delta) but stays ACTIVE on the
-- target: a replace (drop + recreate) of s.f must not let the recreate acquire
-- the default-privilege grant the desired state does not have.
CREATE FUNCTION s.f() RETURNS int LANGUAGE sql AS 'SELECT 2';

ALTER DEFAULT PRIVILEGES IN SCHEMA s GRANT EXECUTE ON FUNCTIONS TO corpus_adp_grantee;
