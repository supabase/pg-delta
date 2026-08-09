-- the function's ARG TYPE changes (integer -> bigint): a different signature
-- entirely. Only the column default references it; the table itself is
-- unchanged and must NOT be dropped/recreated (it holds data).
CREATE SCHEMA probe_default;
CREATE FUNCTION probe_default.make_amount(value bigint)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT value::integer $$;
CREATE TABLE probe_default.items (
  id integer PRIMARY KEY,
  amount integer DEFAULT probe_default.make_amount(1::bigint)
);
