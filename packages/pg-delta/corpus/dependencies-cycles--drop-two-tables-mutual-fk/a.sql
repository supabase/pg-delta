CREATE TABLE public.a (
  id bigserial PRIMARY KEY,
  name text NOT NULL
);
CREATE TABLE public.b (
  id bigserial PRIMARY KEY,
  name text NOT NULL,
  a_id bigint REFERENCES public.a(id)
);
ALTER TABLE public.a ADD COLUMN b_id bigint;
ALTER TABLE public.a ADD CONSTRAINT a_b_fkey FOREIGN KEY (b_id) REFERENCES public.b(id);
