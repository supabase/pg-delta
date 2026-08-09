-- state B: temporal FOREIGN KEY (PERIOD) added on the audit table.
CREATE EXTENSION btree_gist;
CREATE SCHEMA test_schema;
CREATE TABLE test_schema.bookings (
  room_id integer NOT NULL,
  booking_period tstzrange NOT NULL,
  CONSTRAINT bookings_pkey PRIMARY KEY (room_id, booking_period WITHOUT OVERLAPS)
);
CREATE TABLE test_schema.booking_audit (
  room_id integer NOT NULL,
  booking_period tstzrange NOT NULL,
  CONSTRAINT booking_audit_room_id_booking_period_fkey
    FOREIGN KEY (room_id, PERIOD booking_period)
    REFERENCES test_schema.bookings (room_id, PERIOD booking_period)
);
