CREATE SCHEMA pub_test;
CREATE TABLE pub_test.metrics (id SERIAL PRIMARY KEY, value INTEGER);
CREATE PUBLICATION pub_all FOR TABLE pub_test.metrics;
