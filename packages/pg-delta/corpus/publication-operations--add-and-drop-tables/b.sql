CREATE SCHEMA pub_test;
CREATE TABLE pub_test.users (id SERIAL PRIMARY KEY, active BOOLEAN);
CREATE TABLE pub_test.sessions (id SERIAL PRIMARY KEY, user_id INTEGER, active BOOLEAN);
CREATE PUBLICATION pub_tables FOR TABLE pub_test.sessions WHERE (active IS TRUE);
