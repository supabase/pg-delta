-- docs_read reassigned from role_a to role_b; each role exists in only one
-- state, so the plan creates role_b and drops role_a around the
-- ALTER POLICY … TO.
CREATE ROLE role_b NOLOGIN;

CREATE TABLE public.docs (id integer PRIMARY KEY);
ALTER TABLE public.docs ENABLE ROW LEVEL SECURITY;

CREATE POLICY docs_read ON public.docs FOR SELECT TO role_b USING (true);
