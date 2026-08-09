CREATE SCHEMA probe_constraint;
CREATE FUNCTION probe_constraint.is_valid_amount(value integer)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT value > 0 $$;
CREATE TABLE probe_constraint.items (
  id integer PRIMARY KEY,
  amount integer NOT NULL,
  CONSTRAINT amount_is_valid CHECK (probe_constraint.is_valid_amount(amount))
);
