CREATE SCHEMA app;

-- Default sequence parameters (START WITH 1, INCREMENT BY 1) — the bare-clause
-- baseline that the b-state alters in place.
CREATE TABLE app.altered (
  id integer GENERATED ALWAYS AS IDENTITY (START WITH 1 INCREMENT BY 1),
  name text
);
