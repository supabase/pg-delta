-- 'meh' is a NEW enum value, used as the DEFAULT of a NEW column in the SAME
-- plan: the ADD VALUE must be ordered before AND committed before the
-- ALTER TABLE ADD COLUMN, or apply fails with 55P04 / invalid enum input.
CREATE TYPE public.mood AS ENUM ('happy', 'sad', 'meh');

CREATE TABLE public.feelings (
  id integer PRIMARY KEY,
  current_mood public.mood NOT NULL DEFAULT 'meh'
);
