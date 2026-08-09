-- CHECK constraint with special characters in both table name and constraint name
CREATE SCHEMA "my-schema";

CREATE TABLE "my-schema"."my-table" (
  id integer NOT NULL,
  "my-field" text,
  CONSTRAINT "my-table_check$constraint" CHECK ("my-field" IS NOT NULL)
);
