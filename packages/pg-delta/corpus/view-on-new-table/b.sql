CREATE TABLE public.users (id integer PRIMARY KEY, email text NOT NULL, active boolean DEFAULT true);
CREATE VIEW public.active_users AS SELECT id, email FROM public.users WHERE active;
