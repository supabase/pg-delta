-- state B: id widened, qty NOT NULL dropped, note default dropped, old_col
-- dropped, new_col added (with default + NOT NULL).
CREATE SCHEMA corpus_ft;
CREATE FOREIGN DATA WRAPPER corpus_ft_fdw;
CREATE SERVER corpus_ft_server FOREIGN DATA WRAPPER corpus_ft_fdw;
CREATE FOREIGN TABLE corpus_ft.ft (
  id bigint,
  qty integer,
  note text,
  new_col integer DEFAULT 0 NOT NULL
) SERVER corpus_ft_server;
