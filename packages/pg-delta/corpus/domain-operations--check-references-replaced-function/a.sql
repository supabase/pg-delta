CREATE SCHEMA probe_domain_check;

CREATE FUNCTION probe_domain_check.is_valid(value text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$ SELECT length(value) > 0 $$;

-- a domain CHECK constraint whose expression calls the function
CREATE DOMAIN probe_domain_check.code AS text
  CONSTRAINT code_is_valid CHECK (probe_domain_check.is_valid(VALUE));
