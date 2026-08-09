CREATE TABLE public.orders (id bigint PRIMARY KEY, user_id integer NOT NULL, created_at timestamptz);
CREATE INDEX orders_user_idx ON public.orders (user_id);
CREATE UNIQUE INDEX orders_created_key ON public.orders (created_at) WHERE created_at IS NOT NULL;
