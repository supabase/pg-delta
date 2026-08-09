-- state A: role has statement_timeout set
CREATE ROLE api_role NOLOGIN NOINHERIT;
ALTER ROLE api_role SET statement_timeout = '3s';
