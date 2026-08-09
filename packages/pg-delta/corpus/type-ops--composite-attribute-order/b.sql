CREATE SCHEMA s;

-- Composite attribute ORDER is row-layout state: declared order is NOT
-- alphabetical (wal < is_rls_enabled < subscription_ids < errors), so a
-- name-ordered reconstruction would silently reorder the columns. The dependent
-- SQL function pins that order at body-validation time (the realtime.wal_rls
-- chain that motivated the fix).
CREATE TYPE s.wal_rls AS (
  wal jsonb,
  is_rls_enabled boolean,
  subscription_ids uuid[],
  errors text[]
);

CREATE FUNCTION s.apply_rls() RETURNS SETOF s.wal_rls
  LANGUAGE sql AS $$ SELECT NULL::jsonb, NULL::boolean, NULL::uuid[], NULL::text[] $$;

CREATE FUNCTION s.list_changes()
  RETURNS TABLE(wal jsonb, is_rls_enabled boolean, subscription_ids uuid[], errors text[])
  LANGUAGE sql AS $$ SELECT * FROM s.apply_rls() $$;
