DO $$ BEGIN CREATE ROLE corpus_ft_owner NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA corpus_ft;
CREATE FOREIGN DATA WRAPPER corpus_ft_fdw;
CREATE SERVER corpus_ft_server FOREIGN DATA WRAPPER corpus_ft_fdw;
CREATE FOREIGN TABLE corpus_ft.ft (id integer) SERVER corpus_ft_server;
