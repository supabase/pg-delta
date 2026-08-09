CREATE TABLE public.notes (id integer PRIMARY KEY, owner_name text NOT NULL);
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY notes_owner ON public.notes FOR SELECT USING (owner_name = current_user);
