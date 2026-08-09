CREATE TABLE public.users (id integer PRIMARY KEY, name text NOT NULL);
CREATE TABLE public.orders (
  id integer PRIMARY KEY,
  user_id integer NOT NULL,
  CONSTRAINT orders_user_fk FOREIGN KEY (user_id) REFERENCES public.users (id)
);
