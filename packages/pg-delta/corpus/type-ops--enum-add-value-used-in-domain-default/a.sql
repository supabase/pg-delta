CREATE TYPE public.st AS ENUM ('a', 'b');

CREATE DOMAIN public.dst AS public.st;

CREATE TABLE public.t (
  id integer PRIMARY KEY,
  s public.dst DEFAULT 'a'
);
