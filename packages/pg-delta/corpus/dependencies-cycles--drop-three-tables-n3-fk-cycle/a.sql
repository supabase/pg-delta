CREATE TABLE public.a (
  id bigserial PRIMARY KEY,
  b_id bigint
);
CREATE TABLE public.b (
  id bigserial PRIMARY KEY,
  c_id bigint
);
CREATE TABLE public.c (
  id bigserial PRIMARY KEY,
  a_id bigint
);
ALTER TABLE public.a ADD CONSTRAINT a_b_fkey FOREIGN KEY (b_id) REFERENCES public.b(id);
ALTER TABLE public.b ADD CONSTRAINT b_c_fkey FOREIGN KEY (c_id) REFERENCES public.c(id);
ALTER TABLE public.c ADD CONSTRAINT c_a_fkey FOREIGN KEY (a_id) REFERENCES public.a(id);
