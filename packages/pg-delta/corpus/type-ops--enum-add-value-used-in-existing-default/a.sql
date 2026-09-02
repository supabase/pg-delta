CREATE TYPE public.st AS ENUM ('a', 'b');

CREATE TABLE public.t (
  id integer PRIMARY KEY,
  s public.st DEFAULT 'a'
);
