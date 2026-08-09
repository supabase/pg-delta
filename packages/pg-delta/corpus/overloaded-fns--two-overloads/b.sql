-- Two overloads of the same function in public schema
CREATE FUNCTION public.overload_me(a integer, b text)
RETURNS void LANGUAGE plpgsql AS $$ begin end; $$;

CREATE FUNCTION public.overload_me(x bigint)
RETURNS void LANGUAGE plpgsql AS $$ begin end; $$;
