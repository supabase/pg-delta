-- state B: a freshly created role that already carries GUC config. The CREATE
-- must materialize the config (ALTER ROLE ... SET), not just the flags.
CREATE ROLE configured_api NOLOGIN NOINHERIT;
ALTER ROLE configured_api SET statement_timeout = '5s';
ALTER ROLE configured_api SET lock_timeout = '1s';
