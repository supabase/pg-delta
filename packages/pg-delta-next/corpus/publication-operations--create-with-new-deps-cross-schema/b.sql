CREATE SCHEMA pub_dep;
CREATE SCHEMA pub_dep_extra;
CREATE TABLE pub_dep.source_table (id SERIAL PRIMARY KEY);
CREATE TABLE pub_dep_extra.extra_table (id SERIAL PRIMARY KEY);
CREATE PUBLICATION pub_dep_pub FOR TABLE pub_dep.source_table, TABLES IN SCHEMA pub_dep_extra;
