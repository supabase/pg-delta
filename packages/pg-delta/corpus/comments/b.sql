CREATE TABLE public.docs (id integer PRIMARY KEY, body text);
COMMENT ON COLUMN public.docs.body IS 'changed text';
COMMENT ON COLUMN public.docs.id IS 'fresh comment';
