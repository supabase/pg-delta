-- Simple table in public schema. Exercises that the diff engine does not
-- spuriously emit CREATE SCHEMA public (it is pre-populated in the baseline).
CREATE TABLE public.items (id serial PRIMARY KEY);
