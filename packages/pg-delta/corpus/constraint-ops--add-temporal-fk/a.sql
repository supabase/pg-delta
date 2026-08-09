-- state A: temporal-PK parent + audit table with NO foreign key yet
CREATE EXTENSION btree_gist;
CREATE SCHEMA test_schema;
CREATE TABLE test_schema.bookings (
  room_id integer NOT NULL,
  booking_period tstzrange NOT NULL,
  CONSTRAINT bookings_pkey PRIMARY KEY (room_id, booking_period WITHOUT OVERLAPS)
);
CREATE TABLE test_schema.booking_audit (
  room_id integer NOT NULL,
  booking_period tstzrange NOT NULL
);
