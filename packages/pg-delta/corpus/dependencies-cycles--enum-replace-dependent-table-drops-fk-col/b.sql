CREATE TYPE public.item_status AS ENUM ('draft', 'published');

CREATE TABLE public.parents (
  id INTEGER PRIMARY KEY,
  label TEXT
);

CREATE TABLE public.children (
  id INTEGER PRIMARY KEY,
  status public.item_status,
  notes TEXT
);
