-- 'c' is a NEW enum value, used as the NEW DEFAULT of an EXISTING column in
-- the SAME plan: the ADD VALUE must be ordered before AND committed before the
-- ALTER COLUMN … SET DEFAULT, or apply fails with 22P02 (invalid input value
-- for enum). Distinct from enum-add-value-used-in-new-column: there the
-- default is CREATED (a produces walk orders it after the type's alter); here
-- the default is ALTERED in place, so the ordering must come from the
-- alter-vs-alter path.
CREATE TYPE public.st AS ENUM ('a', 'b', 'c');

CREATE TABLE public.t (
  id integer PRIMARY KEY,
  s public.st DEFAULT 'c'
);
