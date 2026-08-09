CREATE SCHEMA app;
CREATE TABLE app.users (
  id integer GENERATED ALWAYS AS IDENTITY,
  email text NOT NULL,
  score numeric(10,2) DEFAULT 0.0,
  CONSTRAINT users_pkey PRIMARY KEY (id),
  CONSTRAINT score_positive CHECK (score >= 0)
);
