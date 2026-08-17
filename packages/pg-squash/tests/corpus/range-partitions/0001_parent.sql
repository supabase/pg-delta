CREATE TABLE part_events (
  id int NOT NULL,
  day date NOT NULL,
  payload text NOT NULL,
  PRIMARY KEY (id, day)
) PARTITION BY RANGE (day);
