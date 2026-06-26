CREATE TYPE public.project_link_type_kind AS ENUM ('a', 'b', 'c');

CREATE TABLE public.project_link_type (
  id SERIAL PRIMARY KEY,
  kind public.project_link_type_kind
);
