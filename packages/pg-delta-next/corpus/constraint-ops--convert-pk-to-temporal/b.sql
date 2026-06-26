-- state B: temporal PRIMARY KEY (room_id, booking_period WITHOUT OVERLAPS).
-- a<->b proves the regular<->temporal PK conversion (drop+add) converges.
CREATE EXTENSION btree_gist;
CREATE SCHEMA test_schema;
CREATE TABLE test_schema.bookings (
  room_id integer NOT NULL,
  booking_period tstzrange NOT NULL,
  CONSTRAINT bookings_pkey PRIMARY KEY (room_id, booking_period WITHOUT OVERLAPS)
);
