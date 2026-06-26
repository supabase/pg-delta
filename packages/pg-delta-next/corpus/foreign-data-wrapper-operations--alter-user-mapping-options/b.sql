-- state B: same mapping with the non-secret option changed (SET user) and a
-- secret option added (ADD password) -- the password must be redacted in the
-- emitted ALTER USER MAPPING ... OPTIONS (SET user 'new_user', ADD password ...)
CREATE FOREIGN DATA WRAPPER test_fdw;
CREATE SERVER test_server FOREIGN DATA WRAPPER test_fdw;
CREATE USER MAPPING FOR CURRENT_USER SERVER test_server OPTIONS (user 'new_user', password 'secret');
