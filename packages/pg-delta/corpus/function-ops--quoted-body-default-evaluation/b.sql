-- Execution-time evaluation of an opaque routine chain.
--
-- `ADD COLUMN … DEFAULT app.api_request_client_info()` does not merely
-- REFERENCE the routine: PostgreSQL RUNS it while applying the statement (to
-- materialize attmissingval / rewrite the rows). The only pg_depend edge the
-- catalog records is default → api_request_client_info; that routine's QUOTED
-- SQL body calls api_request_header, which calls api_request_headers, and
-- neither call is recorded anywhere. So the engine cannot learn the transitive
-- chain — it must schedule the evaluating statement after every ready
-- definition instead.
--
-- Mirrors dbdev's 20230405163940_download_metrics.sql. The definition order
-- below only satisfies THIS fixture's own check_function_bodies; the engine
-- derives its apply order from the catalog, not from this file.
CREATE SCHEMA app;

CREATE FUNCTION app.api_request_headers()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$SELECT coalesce(current_setting('request.headers', true), '{}')::jsonb$function$;

CREATE FUNCTION app.api_request_header(header_name text)
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$SELECT app.api_request_headers() ->> header_name$function$;

CREATE FUNCTION app.api_request_client_info()
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$SELECT coalesce(app.api_request_header('user-agent'), 'unknown')$function$;

CREATE TABLE app.downloads (
  id bigint PRIMARY KEY,
  client_info text DEFAULT app.api_request_client_info()
);
