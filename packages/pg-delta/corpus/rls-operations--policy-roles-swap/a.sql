-- policy granted TO a role that only exists in this state. The
-- ALTER POLICY … TO must run after CREATE of the newly-listed role (consumes)
-- and before DROP of the removed role (releases) — otherwise dropping the old
-- role fails while the policy still references it.
CREATE ROLE role_a NOLOGIN;

CREATE TABLE public.docs (id integer PRIMARY KEY);
ALTER TABLE public.docs ENABLE ROW LEVEL SECURITY;

CREATE POLICY docs_read ON public.docs FOR SELECT TO role_a USING (true);
