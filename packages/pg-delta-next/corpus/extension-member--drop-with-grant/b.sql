DO $$ BEGIN CREATE ROLE corpus_extacl_d NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- No extension: a->b DROPs hstore, which cascades away the member function AND
-- its grant. The member grant's REVOKE must be ordered BEFORE DROP EXTENSION
-- (while the function still exists), not after it.
