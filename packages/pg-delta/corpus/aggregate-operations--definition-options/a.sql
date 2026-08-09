CREATE SCHEMA app;

CREATE FUNCTION app.add_int(integer, integer) RETURNS integer
  LANGUAGE sql IMMUTABLE AS $$ SELECT $1 + $2 $$;
CREATE FUNCTION app.sub_int(integer, integer) RETURNS integer
  LANGUAGE sql IMMUTABLE AS $$ SELECT $1 - $2 $$;
CREATE FUNCTION app.larger_int(integer, integer) RETURNS integer
  LANGUAGE sql IMMUTABLE AS $$ SELECT greatest($1, $2) $$;

-- Plain aggregate: no combine / moving / parallel options.
CREATE AGGREGATE app.mysum(integer)
(
  SFUNC = app.add_int,
  STYPE = integer,
  INITCOND = '0'
);
