DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'corpus_pub_owner') THEN
    CREATE ROLE corpus_pub_owner;
  END IF;
END $$;
CREATE SCHEMA pub_test;
CREATE TABLE pub_test.audit (id SERIAL PRIMARY KEY, payload JSONB);
CREATE PUBLICATION pub_metadata FOR TABLE pub_test.audit;
ALTER PUBLICATION pub_metadata OWNER TO corpus_pub_owner;
COMMENT ON PUBLICATION pub_metadata IS 'audit publication';
