-- composite FK without ON DELETE action
CREATE SCHEMA test_schema;

CREATE TABLE test_schema.parent (
  x int NOT NULL,
  y int NOT NULL,
  UNIQUE (y, x)
);

CREATE TABLE test_schema.child (
  b int NOT NULL,
  a int NOT NULL,
  CONSTRAINT fk_child_parent
    FOREIGN KEY (b, a) REFERENCES test_schema.parent (y, x)
);
