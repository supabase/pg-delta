CREATE SCHEMA "test-schema";
CREATE TYPE "test-schema"."user-status" AS ENUM ('active', 'in-active');
CREATE DOMAIN "test-schema"."positive-number" AS INTEGER CHECK (VALUE > 0);
