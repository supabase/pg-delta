CREATE SCHEMA pub_schema_only;
CREATE TABLE pub_schema_only.t1 (id SERIAL PRIMARY KEY);
CREATE TABLE pub_schema_only.t2 (id SERIAL PRIMARY KEY);
CREATE PUBLICATION pub_schema_pub FOR TABLES IN SCHEMA pub_schema_only;
