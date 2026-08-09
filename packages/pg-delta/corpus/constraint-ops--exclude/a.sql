-- reservations table without EXCLUDE constraint; btree_gist available
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE SCHEMA test_schema;

CREATE TABLE test_schema.reservations (
  id integer PRIMARY KEY,
  room_id integer NOT NULL,
  during tstzrange NOT NULL
);

CREATE TABLE test_schema.expr_excl (
  a integer NOT NULL
);
