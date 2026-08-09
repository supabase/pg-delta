-- Same logical columns (a, b, d) but grown via ALTER TABLE so that b and d
-- have higher physical attnums than in a.sql (dead holes from dropped cols).
-- pg_get_triggerdef() renders identical SQL on both sides, but pg_trigger.tgattr
-- vectors differ. The engine must compare by column names, not raw attnums.
CREATE TABLE public.t (
  a int,
  b int,
  c int
);
ALTER TABLE public.t DROP COLUMN b;
ALTER TABLE public.t DROP COLUMN c;
ALTER TABLE public.t ADD COLUMN b int;
ALTER TABLE public.t ADD COLUMN d int;

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
