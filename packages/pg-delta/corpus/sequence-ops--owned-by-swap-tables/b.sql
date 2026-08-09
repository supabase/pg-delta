-- ownership of app.counter moves from app.t1.id to app.t2.id; each owning
-- table exists in only one state, so the plan creates t2 and drops t1 around
-- the ALTER SEQUENCE … OWNED BY.
CREATE SCHEMA app;

CREATE TABLE app.t2 (id integer PRIMARY KEY);

CREATE SEQUENCE app.counter OWNED BY app.t2.id;
