CREATE TABLE gi_items (
  id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  qty int NOT NULL,
  unit_cents int NOT NULL
);
