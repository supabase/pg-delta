CREATE TYPE public.project_link_type_kind AS ENUM ('a', 'b');

CREATE TABLE public.project_link_type (
  id integer PRIMARY KEY,
  kind public.project_link_type_kind
);
