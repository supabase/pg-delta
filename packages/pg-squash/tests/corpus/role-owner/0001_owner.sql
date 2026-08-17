CREATE ROLE squash_own_app NOLOGIN;
CREATE TABLE squash_owned (id int PRIMARY KEY);
ALTER TABLE squash_owned OWNER TO squash_own_app;
