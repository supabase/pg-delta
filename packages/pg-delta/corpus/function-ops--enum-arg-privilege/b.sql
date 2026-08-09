CREATE ROLE pgdelta_app_user_219 NOLOGIN;
CREATE SCHEMA test_schema;
CREATE TYPE test_schema.entity_kind AS ENUM ('person', 'company', 'organization');
CREATE FUNCTION test_schema.create_entity(p_name text, p_kind test_schema.entity_kind)
RETURNS uuid LANGUAGE sql AS $$ SELECT gen_random_uuid(); $$;
-- privilege change on a function whose signature contains an enum type:
-- the signature must render stably (no temp-schema qualification)
REVOKE ALL ON FUNCTION test_schema.create_entity(text, test_schema.entity_kind) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_schema.create_entity(text, test_schema.entity_kind) TO pgdelta_app_user_219;
