CREATE SCHEMA scheduling;

CREATE TYPE scheduling.time_range AS RANGE (subtype = timestamp);

CREATE TABLE scheduling.events (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  time_slot scheduling.time_range
);

CREATE MATERIALIZED VIEW scheduling.event_durations AS
SELECT
  name,
  EXTRACT(EPOCH FROM (upper(time_slot) - lower(time_slot))) / 3600 as duration_hours
FROM scheduling.events
WHERE time_slot IS NOT NULL;
