CREATE SCHEMA pub_test;
CREATE TABLE pub_test.messages (id SERIAL PRIMARY KEY, body TEXT);
CREATE PUBLICATION pub_drop_test FOR TABLE pub_test.messages;
