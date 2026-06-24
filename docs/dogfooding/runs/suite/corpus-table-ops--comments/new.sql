ALTER TABLE "test_schema"."events" ALTER COLUMN "id" SET NOT NULL

ALTER TABLE "test_schema"."events" ADD CONSTRAINT "events_pkey" PRIMARY KEY (id)

COMMENT ON COLUMN "test_schema"."events"."created_at" IS 'This is a created_at column'

COMMENT ON COLUMN "test_schema"."events"."description" IS 'This is a description column'

COMMENT ON CONSTRAINT "events_pkey" ON "test_schema"."events" IS 'This is a test constraint'

COMMENT ON TABLE "test_schema"."events" IS 'This is a test table'