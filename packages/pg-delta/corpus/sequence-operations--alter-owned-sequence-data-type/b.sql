CREATE SCHEMA test_schema;
CREATE SEQUENCE test_schema.user_id_seq AS bigint;
CREATE TABLE test_schema.users (
  id bigint PRIMARY KEY DEFAULT nextval('test_schema.user_id_seq'::regclass)
);
ALTER SEQUENCE test_schema.user_id_seq OWNED BY test_schema.users.id;
