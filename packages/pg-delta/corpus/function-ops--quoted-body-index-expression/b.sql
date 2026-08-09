-- Building an expression index EVALUATES the expression for every existing row,
-- so `app.normalize_title()` runs at apply time and its quoted SQL body's call
-- to `app.normalize_title_inner()` is invisible to pg_depend (index expressions
-- must be IMMUTABLE, hence the chain is immutable).
--
-- Indexes carry the heaviest create weight in the rule table (14), so this
-- class already ordered correctly before the evaluator stratum existed; the
-- scenario is a PIN that keeps it that way as weights evolve.
CREATE SCHEMA app;

CREATE TABLE app.documents (
  id bigint PRIMARY KEY,
  title text NOT NULL
);

CREATE FUNCTION app.normalize_title_inner(input text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$SELECT lower(btrim(input))$function$;

CREATE FUNCTION app.normalize_title(input text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$SELECT app.normalize_title_inner(input)$function$;

CREATE INDEX documents_title_norm_idx
  ON app.documents ((app.normalize_title(title)));
