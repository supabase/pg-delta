CREATE TYPE public.item_status AS ENUM ('draft', 'published', 'archived');

CREATE TABLE public.parents (
  id INTEGER PRIMARY KEY,
  label TEXT
);

CREATE TABLE public.children (
  id INTEGER PRIMARY KEY,
  parent_ref INTEGER REFERENCES public.parents(id),
  status public.item_status,
  notes TEXT
);
