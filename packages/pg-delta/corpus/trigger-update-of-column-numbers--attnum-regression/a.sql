-- Table built with a single CREATE TABLE: columns a, b, d get consecutive
-- physical attnums 1, 2, 3.
CREATE TABLE public.t (
  a int,
  b int,
  d int
);

CREATE FUNCTION public.trg_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg
  BEFORE UPDATE OF a, b, d
  ON public.t
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn();
