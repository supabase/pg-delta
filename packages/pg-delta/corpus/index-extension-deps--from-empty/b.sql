CREATE EXTENSION pg_trgm;

CREATE TABLE public.items (id integer, label text);

CREATE INDEX idx_items_label_trgm ON public.items USING gin (label gin_trgm_ops);
