import { describe, expect } from "vitest";
import { POSTGRES_VERSIONS } from "../tests/constants.ts";
import { getTest, getTestWithSupabaseIsolated } from "../tests/utils.ts";
import { extractCatalog } from "./catalog.model.ts";
import { stringifyWithBigInt } from "./objects/utils.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  const test = getTest(pgVersion);
  const testWithSupabase = getTestWithSupabaseIsolated(pgVersion);

  test("extract empty catalog", async ({ db }) => {
    const catalog = await extractCatalog(db.a);
    expect(stringifyWithBigInt(catalog)).toMatchSnapshot(
      `catalog-empty-pg${pgVersion}`,
    );
  });

  describe.concurrent(`catalog extraction (pg${pgVersion})`, () => {
    test("extract schemas and basic tables", async ({ db }) => {
      // Create schemas and tables
      await db.a.unsafe(`
        CREATE SCHEMA test_schema;
        CREATE SCHEMA schema_a;
        CREATE SCHEMA schema_b;
        CREATE TABLE test_schema.users (
          id serial PRIMARY KEY,
          name text NOT NULL,
          email text
        );
        CREATE TABLE schema_a.table_a (id int);
        CREATE TABLE schema_b.table_b (id int);
      `);

      const catalog = await extractCatalog(db.a);

      // Check schemas
      expect(catalog.schemas["schema:public"]).toBeDefined();
      expect(catalog.schemas["schema:test_schema"]).toBeDefined();
      expect(catalog.schemas["schema:schema_a"]).toBeDefined();
      expect(catalog.schemas["schema:schema_b"]).toBeDefined();

      // Check tables
      const usersTable = catalog.tables["table:test_schema.users"];
      const tableA = catalog.tables["table:schema_a.table_a"];
      const tableB = catalog.tables["table:schema_b.table_b"];

      expect(usersTable).toBeDefined();
      expect(usersTable.name).toBe("users");
      expect(usersTable.schema).toBe("test_schema");
      expect(usersTable.persistence).toBe("p");
      expect(usersTable.columns).toHaveLength(3);

      expect(tableA).toBeDefined();
      expect(tableB).toBeDefined();

      // Check column details
      expect(usersTable.columns).toStrictEqual([
        expect.objectContaining({
          name: "id",
          data_type_str: "integer",
          not_null: true,
          position: 1,
        }),
        expect.objectContaining({
          name: "name",
          data_type_str: "text",
          not_null: true,
          position: 2,
        }),
        expect.objectContaining({
          name: "email",
          data_type_str: "text",
          not_null: false,
          position: 3,
        }),
      ]);
    });

    test("extract table structure and constraints", async ({ db }) => {
      // Create tables with various types, constraints, and ordering
      await db.a.unsafe(`
        CREATE SCHEMA test_schema;
        CREATE TABLE test_schema.type_test (
          col_int integer,
          col_bigint bigint,
          col_text text,
          col_varchar varchar(50),
          col_boolean boolean,
          col_timestamp timestamp,
          col_numeric numeric(10,2),
          col_uuid uuid
        );
        CREATE TABLE test_schema.constrained_table (
          id serial PRIMARY KEY,
          name text NOT NULL,
          email text,
          age integer CHECK (age > 0)
        );
        CREATE TABLE test_schema.ordered_table (
          third_col text,
          first_col integer,
          second_col boolean
        );
      `);

      const catalog = await extractCatalog(db.a);

      // Test type resolution
      const typeTable = catalog.tables["table:test_schema.type_test"]!;
      expect(typeTable.columns).toHaveLength(8);

      const typeNames = Object.fromEntries(
        typeTable.columns.map((col) => [col.name, col.data_type_str]),
      );
      expect(typeNames["col_int"]).toBe("integer");
      expect(typeNames["col_bigint"]).toBe("bigint");
      expect(typeNames["col_text"]).toBe("text");
      expect(typeNames["col_varchar"]).toBe("character varying(50)");
      expect(typeNames["col_boolean"]).toBe("boolean");
      expect(typeNames["col_timestamp"]).toBe("timestamp without time zone");
      expect(typeNames["col_numeric"]).toBe("numeric(10,2)");
      expect(typeNames["col_uuid"]).toBe("uuid");

      // Test constraints
      const constrainedTable =
        catalog.tables["table:test_schema.constrained_table"]!;
      const idCol = constrainedTable.columns.find((col) => col.name === "id")!;
      const nameCol = constrainedTable.columns.find(
        (col) => col.name === "name",
      )!;
      const emailCol = constrainedTable.columns.find(
        (col) => col.name === "email",
      )!;
      const ageCol = constrainedTable.columns.find(
        (col) => col.name === "age",
      )!;

      expect(idCol.not_null).toBe(true);
      expect(nameCol.not_null).toBe(true);
      expect(emailCol.not_null).toBe(false);
      expect(ageCol.not_null).toBe(false);

      // Test column ordering
      const orderedTable = catalog.tables["table:test_schema.ordered_table"]!;
      expect(orderedTable.columns).toHaveLength(3);
      expect(orderedTable.columns[0].name).toBe("third_col");
      expect(orderedTable.columns[0].position).toBe(1);
      expect(orderedTable.columns[1].name).toBe("first_col");
      expect(orderedTable.columns[1].position).toBe(2);
      expect(orderedTable.columns[2].name).toBe("second_col");
      expect(orderedTable.columns[2].position).toBe(3);
    });

    testWithSupabase("extract type system and dependencies", async ({ db }) => {
      // Create types and check dependencies
      await db.a.unsafe(`
        CREATE SCHEMA test_schema;
        CREATE TYPE test_schema.address AS (
          street varchar,
          city varchar,
          state varchar
        );
        CREATE TYPE test_schema.status AS ENUM ('active', 'inactive', 'pending');
        CREATE TABLE test_schema.users (
          id serial PRIMARY KEY,
          name text
        );
      `);

      const catalog = await extractCatalog(db.a);

      // Test composite types
      expect(Object.keys(catalog.compositeTypes)).toHaveLength(1);
      const compositeType = Object.values(catalog.compositeTypes)[0];
      expect(compositeType.name).toBe("address");
      expect(compositeType.schema).toBe("test_schema");
      expect(compositeType.owner).toBe("supabase_admin");

      // Test enum types
      expect(Object.keys(catalog.enums)).toHaveLength(1);
      const enumType = Object.values(catalog.enums)[0];
      expect(enumType.name).toBe("status");
      expect(enumType.schema).toBe("test_schema");
      expect(enumType.labels.map((l) => l.label)).toEqual([
        "active",
        "inactive",
        "pending",
      ]);

      // Test dependencies
      expect(catalog.depends.length).toBeGreaterThan(0);
      for (const dep of catalog.depends) {
        expect(dep.dependent_stable_id).toBeDefined();
        expect(dep.referenced_stable_id).toBeDefined();
        expect(["n", "a", "i"]).toContain(dep.deptype);
      }
    });

    test("extract view system", async ({ db }) => {
      // Create views and materialized views
      await db.a.unsafe(`
        CREATE SCHEMA test_schema;
        CREATE TABLE test_schema.users (id int, name text);
        CREATE VIEW test_schema.users_view AS SELECT id, name FROM test_schema.users;
        CREATE MATERIALIZED VIEW test_schema.users_mv AS SELECT id, name FROM test_schema.users;
      `);

      const catalog = await extractCatalog(db.a);

      // Test regular views
      expect(Object.keys(catalog.views)).toHaveLength(1);
      const view = catalog.views["view:test_schema.users_view"];
      expect(view.name).toBe("users_view");
      expect(view.schema).toBe("test_schema");
      expect(view.definition).toBeDefined();

      // Test materialized views
      expect(Object.keys(catalog.materializedViews)).toHaveLength(1);
      const mv =
        catalog.materializedViews["materializedView:test_schema.users_mv"];
      expect(mv.name).toBe("users_mv");
      expect(mv.schema).toBe("test_schema");
    });

    test("extract database objects", async ({ db }) => {
      // Create sequences, indexes, triggers, and procedures
      await db.a.unsafe(`
        CREATE SCHEMA test_schema;
        CREATE TABLE test_schema.users (id int, name text);
        CREATE SEQUENCE test_schema.test_seq START 1 INCREMENT 1;
        CREATE INDEX users_name_idx ON test_schema.users (name);
        CREATE OR REPLACE FUNCTION test_schema.log_changes()
        RETURNS TRIGGER AS $$
        BEGIN
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        CREATE TRIGGER users_audit_trigger
          AFTER INSERT OR UPDATE ON test_schema.users
          FOR EACH ROW EXECUTE FUNCTION test_schema.log_changes();
        CREATE OR REPLACE PROCEDURE test_schema.test_proc(param1 int)
        LANGUAGE plpgsql
        AS $$
        BEGIN
          -- procedure body
        END;
        $$;
      `);

      const catalog = await extractCatalog(db.a);

      // Test sequences
      expect(Object.keys(catalog.sequences).length).toBeGreaterThan(0);
      const sequence = catalog.sequences["sequence:test_schema.test_seq"]!;
      expect(sequence.name).toBe("test_seq");
      expect(sequence.schema).toBe("test_schema");

      // Test indexes
      expect(Object.keys(catalog.indexes).length).toBeGreaterThan(0);
      const index = catalog.indexes["index:test_schema.users.users_name_idx"]!;
      expect(index.name).toBe("users_name_idx");
      expect(index.table_schema).toBe("test_schema");
      expect(index.table_name).toBe("users");

      // Test triggers
      expect(Object.keys(catalog.triggers)).toHaveLength(1);
      const trigger =
        catalog.triggers["trigger:test_schema.users.users_audit_trigger"];
      expect(trigger.name).toBe("users_audit_trigger");
      expect(trigger.schema).toBe("test_schema");
      expect(trigger.table_name).toBe("users");

      // Test procedures
      expect(Object.keys(catalog.procedures).length).toBeGreaterThan(0);
      const procedure = catalog.procedures["procedure:test_schema.test_proc"]!;
      expect(procedure.name).toBe("test_proc");
      expect(procedure.schema).toBe("test_schema");
    });

    test("extract advanced features", async ({ db }) => {
      // Create domains, extensions, collations, and RLS policies
      await db.a.unsafe(`
        CREATE SCHEMA test_schema;
        CREATE DOMAIN test_schema.email_address AS varchar(255) CHECK (value LIKE '%@%');
        CREATE COLLATION test_schema.test_collation (locale = 'en_US.utf8');
        CREATE TABLE test_schema.users (id int, name text);
        ALTER TABLE test_schema.users ENABLE ROW LEVEL SECURITY;
        CREATE POLICY users_select_policy ON test_schema.users
          FOR SELECT USING (true);
      `);

      const catalog = await extractCatalog(db.a);

      // Test domains
      expect(Object.keys(catalog.domains)).toHaveLength(1);
      const domain = catalog.domains["domain:test_schema.email_address"];
      expect(domain.name).toBe("email_address");
      expect(domain.schema).toBe("test_schema");
      expect(domain.base_type).toBe("varchar");

      // Test collations
      expect(Object.keys(catalog.collations)).toHaveLength(1);
      const collation =
        catalog.collations["collation:test_schema.test_collation"];
      expect(collation.name).toBe("test_collation");
      expect(collation.schema).toBe("test_schema");

      // Test RLS policies
      expect(Object.keys(catalog.rlsPolicies)).toHaveLength(1);
      const policy =
        catalog.rlsPolicies["rlsPolicy:test_schema.users.users_select_policy"];
      expect(policy.name).toBe("users_select_policy");
      expect(policy.schema).toBe("test_schema");
      expect(policy.table_name).toBe("users");
    });

    testWithSupabase("extract system objects and filtering", async ({ db }) => {
      // Test system schema filtering and role extraction
      await db.a.unsafe("CREATE TABLE public.test_table (id int)");

      const catalog = await extractCatalog(db.a);

      // Test system schema filtering
      const schemaNames = Object.keys(catalog.schemas).map(
        (key) => catalog.schemas[key].schema,
      );
      const systemSchemas = ["information_schema", "pg_catalog", "pg_toast"];

      for (const systemSchema of systemSchemas) {
        expect(schemaNames).not.toContain(systemSchema);
      }
      expect(schemaNames).toContain("public");

      // Test role extraction
      expect(Object.keys(catalog.roles).length).toBeGreaterThan(0);
      const adminRole = catalog.roles["role:supabase_admin"];
      if (adminRole) {
        expect(adminRole.role_name).toBe("supabase_admin");
      }

      // Test extension extraction
      const extension = catalog.extensions["extension:uuid-ossp"];
      if (extension) {
        expect(extension.name).toBe("uuid-ossp");
        expect(extension.schema).toBe("extensions");
      }
    });
  });
}
