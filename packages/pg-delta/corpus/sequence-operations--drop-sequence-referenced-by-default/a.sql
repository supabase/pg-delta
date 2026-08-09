CREATE SCHEMA test_schema;
CREATE SEQUENCE test_schema.my_seq START 1000;
CREATE TABLE test_schema.items (
  id integer PRIMARY KEY DEFAULT nextval('test_schema.my_seq'::regclass),
  name text
);
