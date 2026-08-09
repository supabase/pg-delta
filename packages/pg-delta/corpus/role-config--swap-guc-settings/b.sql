-- state B: statement_timeout removed, lock_timeout added instead
CREATE ROLE api_role NOLOGIN NOINHERIT;
ALTER ROLE api_role SET lock_timeout = '5s';
