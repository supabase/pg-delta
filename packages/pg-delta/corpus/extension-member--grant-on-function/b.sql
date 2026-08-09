DO $$ BEGIN CREATE ROLE corpus_extacl_g NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE EXTENSION hstore SCHEMA public;

-- A GRANT on an extension-member function is USER state layered on the
-- extension. The member object stays reference-only (never re-created — CREATE
-- EXTENSION owns it), but this grant is an init-privs delta that IS diffed and
-- applied. Reverse (b->a) REVOKEs it back to the extension's install state.
GRANT EXECUTE ON FUNCTION hstore(text, text) TO corpus_extacl_g;
