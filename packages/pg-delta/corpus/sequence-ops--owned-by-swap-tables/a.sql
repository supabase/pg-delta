-- sequence OWNED BY a column whose table only exists in this state. The
-- ALTER SEQUENCE … OWNED BY must run after CREATE of the new owning table
-- (consumes) and before DROP of the old owning table (releases) — otherwise
-- dropping the old owner cascades the sequence away first.
CREATE SCHEMA app;

CREATE TABLE app.t1 (id integer PRIMARY KEY);

CREATE SEQUENCE app.counter OWNED BY app.t1.id;
