CREATE SCHEMA app;

-- touch() keeps its signature + return type across a/b, so a change to its body
-- takes the CREATE OR REPLACE alter path. A BEGIN ATOMIC (SQL-standard) body is
-- parsed and dependency-checked at CREATE / CREATE OR REPLACE time (unlike
-- plpgsql / quoted bodies under check_function_bodies=off).
CREATE FUNCTION app.touch()
RETURNS int
LANGUAGE sql
BEGIN ATOMIC
  SELECT 1;
END;
