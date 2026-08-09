CREATE SCHEMA probe_default;
CREATE FUNCTION probe_default.make_amount(value integer)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT value $$;
CREATE TABLE probe_default.items (
  id integer PRIMARY KEY,
  amount integer DEFAULT probe_default.make_amount(1)
);
