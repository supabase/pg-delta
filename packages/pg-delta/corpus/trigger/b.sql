CREATE TABLE public.audit_me (id integer PRIMARY KEY, updated_at timestamptz);
CREATE FUNCTION public.touch() RETURNS trigger LANGUAGE plpgsql AS
$$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
CREATE TRIGGER audit_touch BEFORE UPDATE ON public.audit_me
  FOR EACH ROW EXECUTE FUNCTION public.touch();
