CREATE EXTENSION pg_trgm WITH SCHEMA public;

CREATE SCHEMA app;

CREATE TABLE app.search_items (
  id integer,
  name text
);

CREATE INDEX idx_search_items_name_trgm
  ON app.search_items USING gin (name public.gin_trgm_ops);
