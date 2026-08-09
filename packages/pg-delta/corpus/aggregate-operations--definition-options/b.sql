CREATE SCHEMA app;

CREATE FUNCTION app.add_int(integer, integer) RETURNS integer
  LANGUAGE sql IMMUTABLE AS $$ SELECT $1 + $2 $$;
CREATE FUNCTION app.sub_int(integer, integer) RETURNS integer
  LANGUAGE sql IMMUTABLE AS $$ SELECT $1 - $2 $$;
CREATE FUNCTION app.larger_int(integer, integer) RETURNS integer
  LANGUAGE sql IMMUTABLE AS $$ SELECT greatest($1, $2) $$;

-- Same aggregate, now carrying combine + moving-aggregate + parallel options.
-- These are drop+create only, so the forward diff must recreate it; without
-- extracting/rendering the options the recreated aggregate would silently
-- lose them (and the diff would be empty, the payloads having hashed equal).
CREATE AGGREGATE app.mysum(integer)
(
  SFUNC = app.add_int,
  STYPE = integer,
  INITCOND = '0',
  COMBINEFUNC = app.add_int,
  MSFUNC = app.add_int,
  MINVFUNC = app.sub_int,
  MSTYPE = integer,
  MINITCOND = '0',
  PARALLEL = SAFE
);

-- New aggregate exercising SORTOP rendering through the create path.
CREATE AGGREGATE app.mymax(integer)
(
  SFUNC = app.larger_int,
  STYPE = integer,
  SORTOP = >
);
