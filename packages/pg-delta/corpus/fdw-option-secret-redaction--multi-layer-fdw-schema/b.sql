-- Rich FDW schema with options at every layer (FDW, server, user mapping, foreign table).
-- Exercises ordering: FDW must precede server, server must precede user mapping and foreign table.
-- Secret values are present in OPTIONS to verify the new engine also redacts them in output.
CREATE FOREIGN DATA WRAPPER corpus_cli1467_fdw OPTIONS (
  use_remote_estimate 'true',
  password 'fdw-shared-secret',
  api_key 'fdw-api-key'
);
CREATE SERVER corpus_cli1467_server FOREIGN DATA WRAPPER corpus_cli1467_fdw OPTIONS (
  host 'remote.example.com',
  port '5432',
  password 'real-user-password',
  passfile '/etc/secrets/passfile'
);
CREATE USER MAPPING FOR CURRENT_USER SERVER corpus_cli1467_server OPTIONS (
  "user" 'fdw_reader',
  password 'real-user-password',
  passcode 'krb-passcode',
  sslpassword 'ssl-secret'
);
CREATE FOREIGN TABLE public.corpus_cli1467_table (id integer) SERVER corpus_cli1467_server OPTIONS (
  schema_name 'remote_schema',
  password 'table-shared-secret'
);
