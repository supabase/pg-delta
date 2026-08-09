-- btree_gist provides the GiST opclass the scalar key part of a temporal
-- PRIMARY KEY needs; present in both states so only the tables differ.
CREATE EXTENSION btree_gist;
CREATE SCHEMA test_schema;
