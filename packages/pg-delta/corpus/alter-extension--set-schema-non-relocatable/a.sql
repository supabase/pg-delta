-- xml2 is a NON-relocatable extension: PostgreSQL rejects
-- ALTER EXTENSION xml2 SET SCHEMA. Relocating it between states must therefore
-- be planned as drop + recreate in the new schema, not an in-place ALTER.
CREATE SCHEMA schema_a;

CREATE EXTENSION xml2 SCHEMA schema_a;
