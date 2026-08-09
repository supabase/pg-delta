-- state B: role has pgrst.db_aggregates_enabled GUC set (ALTER ROLE ... SET)
CREATE ROLE authenticator NOLOGIN NOINHERIT;
ALTER ROLE authenticator SET pgrst.db_aggregates_enabled = 'true';
