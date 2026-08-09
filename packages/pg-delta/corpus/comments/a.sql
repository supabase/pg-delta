CREATE TABLE public.docs (id integer PRIMARY KEY, body text);
COMMENT ON TABLE public.docs IS 'documents';
COMMENT ON COLUMN public.docs.body IS 'will change';
