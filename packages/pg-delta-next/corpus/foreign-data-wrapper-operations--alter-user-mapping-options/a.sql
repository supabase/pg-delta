-- state A: FDW + server + user mapping with a non-secret option only
CREATE FOREIGN DATA WRAPPER test_fdw;
CREATE SERVER test_server FOREIGN DATA WRAPPER test_fdw;
CREATE USER MAPPING FOR CURRENT_USER SERVER test_server OPTIONS (user 'remote_user');
