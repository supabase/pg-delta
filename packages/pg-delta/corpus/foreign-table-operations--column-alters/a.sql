-- state A: foreign table with a NOT NULL column, a defaulted column, and a
-- column that B drops. a<->b exercises every column alter in both directions.
CREATE SCHEMA corpus_ft;
CREATE FOREIGN DATA WRAPPER corpus_ft_fdw;
CREATE SERVER corpus_ft_server FOREIGN DATA WRAPPER corpus_ft_fdw;
CREATE FOREIGN TABLE corpus_ft.ft (
  id integer,
  qty integer NOT NULL,
  note text DEFAULT 'x',
  old_col text
) SERVER corpus_ft_server;
