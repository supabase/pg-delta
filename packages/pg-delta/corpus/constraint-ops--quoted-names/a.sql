-- table with hyphenated schema/table/column names but no constraint yet
CREATE SCHEMA "my-schema";

CREATE TABLE "my-schema"."my-table" (
  id integer NOT NULL,
  "my-field" text
);
