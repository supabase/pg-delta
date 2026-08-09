CREATE EXTENSION pg_trgm;

CREATE TABLE public.documents (
  id integer,
  content text
);

CREATE INDEX idx_documents_content_trgm
  ON public.documents USING gin (content gin_trgm_ops);
