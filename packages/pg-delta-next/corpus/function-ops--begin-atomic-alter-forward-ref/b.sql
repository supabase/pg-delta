CREATE SCHEMA app;

-- NEW helper function, named so it sorts AFTER touch() — so the deterministic
-- tie-break alone would place its CREATE *after* touch()'s CREATE OR REPLACE.
-- touch()'s updated BEGIN ATOMIC body calls it, and that body is dependency-
-- checked at replace time, so the alter must be ordered AFTER the helper's
-- create. Only the def-alter's `consumes` of touch's `depends` targets forces
-- that order; without it apply fails ("function app.zzz_helper() does not
-- exist"). Reverse (b->a): the alter drops the call and must precede
-- DROP FUNCTION app.zzz_helper() (the alterer-before-dependency-teardown edge).
CREATE FUNCTION app.zzz_helper()
RETURNS int
LANGUAGE sql
BEGIN ATOMIC
  SELECT 42;
END;

CREATE FUNCTION app.touch()
RETURNS int
LANGUAGE sql
BEGIN ATOMIC
  SELECT app.zzz_helper();
END;
