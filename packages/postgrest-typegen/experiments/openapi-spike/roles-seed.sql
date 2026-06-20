-- Spike-only PostgREST role setup.
--
-- The shared introspection fixtures (00-init.sql / 01-memes.sql) describe a
-- schema but do not create the PostgREST auth roles. PostgREST connects as an
-- `authenticator` role and switches to the anonymous role for unauthenticated
-- requests, so we add both here and grant the anon role broad read/execute
-- access on `public` so the OpenAPI surface is as complete as possible.
--
-- This file is applied AFTER the fixtures and is throwaway spike scaffolding —
-- it is never imported by the package and ships no changeset.

create role anon nologin;
create role authenticator noinherit login password 'authpass';
grant anon to authenticator;

grant usage on schema public to anon;
grant all on all tables in schema public to anon;
grant all on all sequences in schema public to anon;
grant all on all functions in schema public to anon;
grant all on all routines in schema public to anon;

-- Cover objects created after this seed runs (none in this spike, but harmless).
alter default privileges in schema public grant all on tables to anon;
alter default privileges in schema public grant all on functions to anon;
alter default privileges in schema public grant all on routines to anon;
