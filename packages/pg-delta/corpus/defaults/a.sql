CREATE TABLE public.items (
  id integer PRIMARY KEY,
  price numeric DEFAULT 0.0,
  status text DEFAULT 'new'
);
