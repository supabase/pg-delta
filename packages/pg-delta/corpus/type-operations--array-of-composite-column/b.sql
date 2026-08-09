CREATE SCHEMA s;

CREATE TYPE s.user_defined_filter AS (
  column_name text,
  value text
);

-- Table with a column whose type is an ARRAY of the composite type. Postgres
-- records the column's pg_depend edge against the array type `_user_defined_filter`,
-- so the table must still be ordered AFTER the composite type it elements.
CREATE TABLE s.subscription (
  id bigint NOT NULL,
  filters s.user_defined_filter[] NOT NULL DEFAULT '{}'
);

-- Also exercise the function-argument form (same array-of-composite dependency).
CREATE FUNCTION s.check_filters(filters s.user_defined_filter[])
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT true $$;
