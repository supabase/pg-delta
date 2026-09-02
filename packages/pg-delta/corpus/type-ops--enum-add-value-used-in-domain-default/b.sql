-- 'c' is a NEW enum value used as the NEW DEFAULT of an EXISTING column
-- whose type is an UNCHANGED domain over the enum. The default depends on
-- the domain, not the enum; ADD VALUE must still run (and commit) first.
CREATE TYPE public.st AS ENUM ('a', 'b', 'c');

CREATE DOMAIN public.dst AS public.st;

CREATE TABLE public.t (
  id integer PRIMARY KEY,
  s public.dst DEFAULT 'c'
);
