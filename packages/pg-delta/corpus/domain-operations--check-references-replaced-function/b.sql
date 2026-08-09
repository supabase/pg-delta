CREATE SCHEMA probe_domain_check;

-- parameter renamed value->input: CREATE OR REPLACE cannot rename a
-- parameter, so this forces DROP+CREATE of the function (same stable id).
-- The domain CHECK expression is textually IDENTICAL, so only the function
-- changes — the domain constraint must still be rebuilt around the replace.
CREATE FUNCTION probe_domain_check.is_valid(input text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$ SELECT length(input) > 0 $$;

CREATE DOMAIN probe_domain_check.code AS text
  CONSTRAINT code_is_valid CHECK (probe_domain_check.is_valid(VALUE));
