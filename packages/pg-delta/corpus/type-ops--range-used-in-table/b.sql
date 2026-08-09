CREATE SCHEMA app;
CREATE TYPE app.int_range AS RANGE (subtype = int4);
CREATE TABLE app.bookings (
  id integer PRIMARY KEY,
  span app.int_range NOT NULL
);
