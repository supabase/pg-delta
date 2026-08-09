CREATE SCHEMA test_schema;
CREATE SEQUENCE test_schema.user_id_seq;
CREATE TABLE test_schema.users (
  name text NOT NULL,
  id bigint DEFAULT nextval('test_schema.user_id_seq')
);
ALTER SEQUENCE test_schema.user_id_seq OWNED BY test_schema.users.id;
