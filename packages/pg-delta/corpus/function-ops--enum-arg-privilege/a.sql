CREATE ROLE pgdelta_app_user_219 NOLOGIN;
CREATE SCHEMA test_schema;
CREATE TYPE test_schema.entity_kind AS ENUM ('person', 'company', 'organization');
CREATE FUNCTION test_schema.create_entity(p_name text, p_kind test_schema.entity_kind)
RETURNS uuid LANGUAGE sql AS $$ SELECT gen_random_uuid(); $$;
