-- reservations gains an EXCLUDE USING gist constraint for room/time non-overlap;
-- expr_excl gains an EXCLUDE over an expression (attnum=0 regression guard)
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE SCHEMA test_schema;

CREATE TABLE test_schema.reservations (
  id integer PRIMARY KEY,
  room_id integer NOT NULL,
  during tstzrange NOT NULL,
  CONSTRAINT no_overlap EXCLUDE USING gist (room_id WITH =, during WITH &&)
);

CREATE TABLE test_schema.expr_excl (
  a integer NOT NULL,
  CONSTRAINT expr_excl_check EXCLUDE USING gist ((a + 0) WITH =)
);
