-- Same opaque routine chain as function-ops--quoted-body-default-evaluation,
-- but materialized through a STORED generated column instead of a DEFAULT.
--
-- A generated column carries NO `default` fact: the extractor shadows the
-- expression's pg_depend edges onto the COLUMN fact itself. The backfill still
-- RUNS api_request_client_info() while the ADD COLUMN applies, and the quoted
-- bodies below hide the api_request_header / api_request_headers hops from the
-- catalog. Generation expressions must be IMMUTABLE, hence the chain is
-- immutable here.
CREATE SCHEMA app;

CREATE FUNCTION app.api_request_headers()
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
AS $function$SELECT '{"user-agent": "pgdelta"}'::jsonb$function$;

CREATE FUNCTION app.api_request_header(header_name text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$SELECT app.api_request_headers() ->> header_name$function$;

CREATE FUNCTION app.api_request_client_info()
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$SELECT coalesce(app.api_request_header('user-agent'), 'unknown')$function$;

CREATE TABLE app.downloads (
  id bigint PRIMARY KEY,
  client_info text GENERATED ALWAYS AS (app.api_request_client_info() || ':' || id::text) STORED
);
