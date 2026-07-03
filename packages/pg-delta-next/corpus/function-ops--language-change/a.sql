CREATE SCHEMA s;

-- LANGUAGE change (sql -> plpgsql, same signature + return type) is in the
-- replace set: pg-delta-next demolishes (drop + recreate) rather than altering
-- in place. Postgres actually permits CREATE OR REPLACE to switch language, but
-- drop-and-recreate is unconditionally safe and keeps the classifier simple.
CREATE FUNCTION s.f() RETURNS int LANGUAGE sql AS 'SELECT 1';
