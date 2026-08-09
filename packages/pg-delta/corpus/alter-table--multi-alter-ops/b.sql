-- multiple column changes applied at once: add email, widen old_name type, drop status column
CREATE SCHEMA test_schema;

CREATE TABLE test_schema.evolution (
  id integer NOT NULL,
  old_name text,
  email character varying(255)
);
