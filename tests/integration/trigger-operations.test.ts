/**
 * Integration tests for PostgreSQL trigger operations.
 */

import { describe } from "vitest";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { getTest } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  const test = getTest(pgVersion);

  describe.concurrent(`trigger operations (pg${pgVersion})`, () => {
    test("simple trigger creation", async ({ db }) => {
      await roundtripFidelityTest({
        masterSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.users (
            id serial PRIMARY KEY,
            name text NOT NULL,
            updated_at timestamp DEFAULT now()
          );
          CREATE FUNCTION test_schema.update_timestamp()
          RETURNS trigger
          LANGUAGE plpgsql
          AS $$
          BEGIN
            NEW.updated_at = now();
            RETURN NEW;
          END;
          $$;
        `,
        testSql: `
          CREATE TRIGGER update_timestamp_trigger
          BEFORE UPDATE ON test_schema.users
          FOR EACH ROW
          EXECUTE FUNCTION test_schema.update_timestamp();
        `,
        description: "simple trigger creation",
        expectedSqlTerms: [
          `CREATE TRIGGER update_timestamp_trigger BEFORE UPDATE ON test_schema.users FOR EACH ROW EXECUTE FUNCTION test_schema.update_timestamp()`,
        ],
        expectedMasterDependencies: [
          {
            dependent_stable_id: "function:test_schema.update_timestamp()",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "table:test_schema.users",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "sequence:test_schema.users_id_seq",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "sequence:test_schema.users_id_seq",
            referenced_stable_id: "table:test_schema.users",
            deptype: "n",
          },
          {
            dependent_stable_id: "constraint:test_schema.users.users_pkey",
            referenced_stable_id: "table:test_schema.users",
            deptype: "a",
          },
          {
            dependent_stable_id: "index:test_schema.users_pkey",
            referenced_stable_id: "constraint:test_schema.users.users_pkey",
            deptype: "i",
          },
        ],
        expectedBranchDependencies: [
          {
            dependent_stable_id: "function:test_schema.update_timestamp()",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "table:test_schema.users",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "sequence:test_schema.users_id_seq",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "sequence:test_schema.users_id_seq",
            referenced_stable_id: "table:test_schema.users",
            deptype: "n",
          },
          {
            dependent_stable_id: "constraint:test_schema.users.users_pkey",
            referenced_stable_id: "table:test_schema.users",
            deptype: "a",
          },
          {
            dependent_stable_id: "index:test_schema.users_pkey",
            referenced_stable_id: "constraint:test_schema.users.users_pkey",
            deptype: "i",
          },
          {
            dependent_stable_id:
              "trigger:test_schema.users.update_timestamp_trigger",
            referenced_stable_id: "function:test_schema.update_timestamp()",
            deptype: "n",
          },
          {
            dependent_stable_id:
              "trigger:test_schema.users.update_timestamp_trigger",
            referenced_stable_id: "table:test_schema.users",
            deptype: "n",
          },
        ],
      });
    });

    test("multi-event trigger", async ({ db }) => {
      await roundtripFidelityTest({
        masterSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.audit_log (
            id serial PRIMARY KEY,
            table_name text,
            operation text,
            old_data jsonb,
            new_data jsonb,
            changed_at timestamp DEFAULT now()
          );
          CREATE TABLE test_schema.sensitive_data (
            id serial PRIMARY KEY,
            secret_value text
          );
          CREATE FUNCTION test_schema.audit_changes()
          RETURNS trigger
          LANGUAGE plpgsql
          AS $$
          BEGIN
            IF TG_OP = 'DELETE' THEN
              INSERT INTO test_schema.audit_log (table_name, operation, old_data)
              VALUES (TG_TABLE_NAME, TG_OP, row_to_json(OLD));
              RETURN OLD;
            ELSE
              INSERT INTO test_schema.audit_log (table_name, operation, new_data)
              VALUES (TG_TABLE_NAME, TG_OP, row_to_json(NEW));
              RETURN NEW;
            END IF;
          END;
          $$;
        `,
        testSql: `
          CREATE TRIGGER audit_trigger
          AFTER INSERT OR UPDATE OR DELETE ON test_schema.sensitive_data
          FOR EACH ROW
          EXECUTE FUNCTION test_schema.audit_changes();
        `,
        description: "multi-event trigger",
        expectedSqlTerms: [
          `CREATE TRIGGER audit_trigger AFTER INSERT OR DELETE OR UPDATE ON test_schema.sensitive_data FOR EACH ROW EXECUTE FUNCTION test_schema.audit_changes()`,
        ],
        expectedMasterDependencies: [
          {
            dependent_stable_id: "function:test_schema.audit_changes()",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "table:test_schema.audit_log",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "table:test_schema.sensitive_data",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "sequence:test_schema.audit_log_id_seq",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "sequence:test_schema.audit_log_id_seq",
            referenced_stable_id: "table:test_schema.audit_log",
            deptype: "n",
          },
          {
            dependent_stable_id: "sequence:test_schema.sensitive_data_id_seq",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "sequence:test_schema.sensitive_data_id_seq",
            referenced_stable_id: "table:test_schema.sensitive_data",
            deptype: "n",
          },
          {
            dependent_stable_id: "index:test_schema.audit_log_pkey",
            referenced_stable_id:
              "constraint:test_schema.audit_log.audit_log_pkey",
            deptype: "i",
          },
          {
            dependent_stable_id:
              "constraint:test_schema.audit_log.audit_log_pkey",
            referenced_stable_id: "table:test_schema.audit_log",
            deptype: "a",
          },
          {
            dependent_stable_id: "index:test_schema.sensitive_data_pkey",
            referenced_stable_id:
              "constraint:test_schema.sensitive_data.sensitive_data_pkey",
            deptype: "i",
          },
          {
            dependent_stable_id:
              "constraint:test_schema.sensitive_data.sensitive_data_pkey",
            referenced_stable_id: "table:test_schema.sensitive_data",
            deptype: "a",
          },
        ],
        expectedBranchDependencies: [
          {
            dependent_stable_id: "function:test_schema.audit_changes()",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "table:test_schema.audit_log",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "table:test_schema.sensitive_data",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "sequence:test_schema.audit_log_id_seq",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "sequence:test_schema.audit_log_id_seq",
            referenced_stable_id: "table:test_schema.audit_log",
            deptype: "n",
          },
          {
            dependent_stable_id: "sequence:test_schema.sensitive_data_id_seq",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "sequence:test_schema.sensitive_data_id_seq",
            referenced_stable_id: "table:test_schema.sensitive_data",
            deptype: "n",
          },
          {
            dependent_stable_id: "index:test_schema.audit_log_pkey",
            referenced_stable_id:
              "constraint:test_schema.audit_log.audit_log_pkey",
            deptype: "i",
          },
          {
            dependent_stable_id:
              "constraint:test_schema.audit_log.audit_log_pkey",
            referenced_stable_id: "table:test_schema.audit_log",
            deptype: "a",
          },
          {
            dependent_stable_id: "index:test_schema.sensitive_data_pkey",
            referenced_stable_id:
              "constraint:test_schema.sensitive_data.sensitive_data_pkey",
            deptype: "i",
          },
          {
            dependent_stable_id:
              "constraint:test_schema.sensitive_data.sensitive_data_pkey",
            referenced_stable_id: "table:test_schema.sensitive_data",
            deptype: "a",
          },
          {
            dependent_stable_id:
              "trigger:test_schema.sensitive_data.audit_trigger",
            referenced_stable_id: "function:test_schema.audit_changes()",
            deptype: "n",
          },
          {
            dependent_stable_id:
              "trigger:test_schema.sensitive_data.audit_trigger",
            referenced_stable_id: "table:test_schema.sensitive_data",
            deptype: "n",
          },
        ],
      });
    });

    test("conditional trigger with WHEN clause", async ({ db }) => {
      await roundtripFidelityTest({
        masterSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.products (
            id serial PRIMARY KEY,
            name text NOT NULL,
            price numeric(10,2),
            category text
          );
          CREATE FUNCTION test_schema.log_price_changes()
          RETURNS trigger
          LANGUAGE plpgsql
          AS $$
          BEGIN
            RAISE NOTICE 'Price changed for product %: % -> %', NEW.name, OLD.price, NEW.price;
            RETURN NEW;
          END;
          $$;
        `,
        testSql: `
          CREATE TRIGGER price_change_trigger
          AFTER UPDATE ON test_schema.products
          FOR EACH ROW
          WHEN (OLD.price IS DISTINCT FROM NEW.price)
          EXECUTE FUNCTION test_schema.log_price_changes();
        `,
        description: "conditional trigger with WHEN clause",
        expectedSqlTerms: [
          `CREATE TRIGGER price_change_trigger AFTER UPDATE ON test_schema.products FOR EACH ROW WHEN ((old.price IS DISTINCT FROM new.price)) EXECUTE FUNCTION test_schema.log_price_changes()`,
        ],
        expectedMasterDependencies: [
          {
            dependent_stable_id: "function:test_schema.log_price_changes()",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "table:test_schema.products",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "sequence:test_schema.products_id_seq",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "sequence:test_schema.products_id_seq",
            referenced_stable_id: "table:test_schema.products",
            deptype: "n",
          },
          {
            dependent_stable_id:
              "constraint:test_schema.products.products_pkey",
            referenced_stable_id: "table:test_schema.products",
            deptype: "a",
          },
          {
            dependent_stable_id: "index:test_schema.products_pkey",
            referenced_stable_id:
              "constraint:test_schema.products.products_pkey",
            deptype: "i",
          },
        ],
        expectedBranchDependencies: [
          {
            dependent_stable_id: "function:test_schema.log_price_changes()",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "table:test_schema.products",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "sequence:test_schema.products_id_seq",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "sequence:test_schema.products_id_seq",
            referenced_stable_id: "table:test_schema.products",
            deptype: "n",
          },
          {
            dependent_stable_id:
              "constraint:test_schema.products.products_pkey",
            referenced_stable_id: "table:test_schema.products",
            deptype: "a",
          },
          {
            dependent_stable_id: "index:test_schema.products_pkey",
            referenced_stable_id:
              "constraint:test_schema.products.products_pkey",
            deptype: "i",
          },
          {
            dependent_stable_id:
              "trigger:test_schema.products.price_change_trigger",
            referenced_stable_id: "function:test_schema.log_price_changes()",
            deptype: "n",
          },
          {
            dependent_stable_id:
              "trigger:test_schema.products.price_change_trigger",
            referenced_stable_id: "table:test_schema.products",
            deptype: "n",
          },
        ],
      });
    });

    test("trigger dropping", async ({ db }) => {
      await roundtripFidelityTest({
        masterSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.test_table (
            id serial PRIMARY KEY,
            value text
          );
          CREATE FUNCTION test_schema.test_trigger_func()
          RETURNS trigger
          LANGUAGE plpgsql
          AS 'BEGIN RETURN NEW; END;';
          CREATE TRIGGER old_trigger
          BEFORE INSERT ON test_schema.test_table
          FOR EACH ROW
          EXECUTE FUNCTION test_schema.test_trigger_func();
        `,
        testSql: `DROP TRIGGER old_trigger ON test_schema.test_table;`,
        description: "trigger dropping",
        expectedSqlTerms: [
          `DROP TRIGGER old_trigger ON test_schema.test_table`,
        ],
        expectedMasterDependencies: [
          {
            dependent_stable_id: "function:test_schema.test_trigger_func()",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "table:test_schema.test_table",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "sequence:test_schema.test_table_id_seq",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "sequence:test_schema.test_table_id_seq",
            referenced_stable_id: "table:test_schema.test_table",
            deptype: "n",
          },
          {
            dependent_stable_id:
              "constraint:test_schema.test_table.test_table_pkey",
            referenced_stable_id: "table:test_schema.test_table",
            deptype: "a",
          },
          {
            dependent_stable_id: "index:test_schema.test_table_pkey",
            referenced_stable_id:
              "constraint:test_schema.test_table.test_table_pkey",
            deptype: "i",
          },
          {
            dependent_stable_id: "trigger:test_schema.test_table.old_trigger",
            referenced_stable_id: "function:test_schema.test_trigger_func()",
            deptype: "n",
          },
          {
            dependent_stable_id: "trigger:test_schema.test_table.old_trigger",
            referenced_stable_id: "table:test_schema.test_table",
            deptype: "n",
          },
        ],
        expectedBranchDependencies: [
          {
            dependent_stable_id: "function:test_schema.test_trigger_func()",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "table:test_schema.test_table",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "sequence:test_schema.test_table_id_seq",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "sequence:test_schema.test_table_id_seq",
            referenced_stable_id: "table:test_schema.test_table",
            deptype: "n",
          },
          {
            dependent_stable_id:
              "constraint:test_schema.test_table.test_table_pkey",
            referenced_stable_id: "table:test_schema.test_table",
            deptype: "a",
          },
          {
            dependent_stable_id: "index:test_schema.test_table_pkey",
            referenced_stable_id:
              "constraint:test_schema.test_table.test_table_pkey",
            deptype: "i",
          },
        ],
      });
    });

    test("trigger replacement (modification)", async ({ db }) => {
      await roundtripFidelityTest({
        masterSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.users (
            id serial PRIMARY KEY,
            email text UNIQUE,
            created_at timestamp DEFAULT now()
          );
          CREATE FUNCTION test_schema.validate_email()
          RETURNS trigger
          LANGUAGE plpgsql
          AS $$
          BEGIN
            IF NEW.email !~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$' THEN
              RAISE EXCEPTION 'Invalid email format';
            END IF;
            RETURN NEW;
          END;
          $$;
          CREATE TRIGGER email_validation_trigger
          BEFORE INSERT ON test_schema.users
          FOR EACH ROW
          EXECUTE FUNCTION test_schema.validate_email();
        `,
        testSql: `
          CREATE OR REPLACE FUNCTION test_schema.validate_email()
          RETURNS trigger
          LANGUAGE plpgsql
          AS $$
          BEGIN
            -- Updated validation logic
            IF NEW.email !~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$' THEN
              RAISE EXCEPTION 'Invalid email format: %', NEW.email;
            END IF;
            -- Additional validation
            IF length(NEW.email) > 255 THEN
              RAISE EXCEPTION 'Email too long';
            END IF;
            RETURN NEW;
          END;
          $$;

          -- Recreate trigger with updated timing
          DROP TRIGGER email_validation_trigger ON test_schema.users;
          CREATE TRIGGER email_validation_trigger
          BEFORE INSERT OR UPDATE ON test_schema.users
          FOR EACH ROW
          EXECUTE FUNCTION test_schema.validate_email();
        `,
        description: "trigger replacement (modification)",
        expectedSqlTerms: [
          `CREATE OR REPLACE FUNCTION test_schema.validate_email() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ((NEW.email !~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$')) THEN RAISE EXCEPTION 'Invalid email format: %', NEW.email; END IF; IF ((length(NEW.email) > 255)) THEN RAISE EXCEPTION 'Email too long'; END IF; RETURN NEW; END; $$`,
          `DROP TRIGGER email_validation_trigger ON test_schema.users`,
          `CREATE TRIGGER email_validation_trigger BEFORE INSERT OR UPDATE ON test_schema.users FOR EACH ROW EXECUTE FUNCTION test_schema.validate_email()`,
        ],
        expectedMasterDependencies: [
          {
            dependent_stable_id: "function:test_schema.validate_email()",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "table:test_schema.users",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "sequence:test_schema.users_id_seq",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "sequence:test_schema.users_id_seq",
            referenced_stable_id: "table:test_schema.users",
            deptype: "n",
          },
          {
            dependent_stable_id: "index:test_schema.users_pkey",
            referenced_stable_id: "constraint:test_schema.users.users_pkey",
            deptype: "i",
          },
          {
            dependent_stable_id: "constraint:test_schema.users.users_pkey",
            referenced_stable_id: "table:test_schema.users",
            deptype: "a",
          },
          {
            dependent_stable_id: "index:test_schema.users_email_key",
            referenced_stable_id:
              "constraint:test_schema.users.users_email_key",
            deptype: "i",
          },
          {
            dependent_stable_id: "constraint:test_schema.users.users_email_key",
            referenced_stable_id: "table:test_schema.users",
            deptype: "a",
          },
          {
            dependent_stable_id:
              "trigger:test_schema.users.email_validation_trigger",
            referenced_stable_id: "function:test_schema.validate_email()",
            deptype: "n",
          },
          {
            dependent_stable_id:
              "trigger:test_schema.users.email_validation_trigger",
            referenced_stable_id: "table:test_schema.users",
            deptype: "n",
          },
        ],
        expectedBranchDependencies: [
          {
            dependent_stable_id: "function:test_schema.validate_email()",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "table:test_schema.users",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "sequence:test_schema.users_id_seq",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "sequence:test_schema.users_id_seq",
            referenced_stable_id: "table:test_schema.users",
            deptype: "n",
          },
          {
            dependent_stable_id: "index:test_schema.users_pkey",
            referenced_stable_id: "constraint:test_schema.users.users_pkey",
            deptype: "i",
          },
          {
            dependent_stable_id: "constraint:test_schema.users.users_pkey",
            referenced_stable_id: "table:test_schema.users",
            deptype: "a",
          },
          {
            dependent_stable_id: "index:test_schema.users_email_key",
            referenced_stable_id:
              "constraint:test_schema.users.users_email_key",
            deptype: "i",
          },
          {
            dependent_stable_id: "constraint:test_schema.users.users_email_key",
            referenced_stable_id: "table:test_schema.users",
            deptype: "a",
          },
          {
            dependent_stable_id:
              "trigger:test_schema.users.email_validation_trigger",
            referenced_stable_id: "function:test_schema.validate_email()",
            deptype: "n",
          },
          {
            dependent_stable_id:
              "trigger:test_schema.users.email_validation_trigger",
            referenced_stable_id: "table:test_schema.users",
            deptype: "n",
          },
        ],
      });
    });

    test("trigger after function dependency", async ({ db }) => {
      await roundtripFidelityTest({
        masterSession: db.main,
        branchSession: db.branch,
        initialSetup: "CREATE SCHEMA test_schema",
        testSql: `
          CREATE TABLE test_schema.events (
            id serial PRIMARY KEY,
            event_type text,
            occurred_at timestamp DEFAULT now()
          );

          CREATE FUNCTION test_schema.notify_event()
          RETURNS trigger
          LANGUAGE plpgsql
          AS $$
          BEGIN
            PERFORM pg_notify('event_occurred', NEW.event_type);
            RETURN NEW;
          END;
          $$;

          CREATE TRIGGER event_notification_trigger
          AFTER INSERT ON test_schema.events
          FOR EACH ROW
          EXECUTE FUNCTION test_schema.notify_event();
        `,
        description: "trigger after function dependency",
        expectedSqlTerms: [
          `CREATE TABLE test_schema.events (id serial PRIMARY KEY, event_type text, occurred_at timestamp DEFAULT now())`,
          `CREATE OR REPLACE FUNCTION test_schema.notify_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_notify('event_occurred', NEW.event_type); RETURN NEW; END; $$`,
          `CREATE TRIGGER event_notification_trigger AFTER INSERT ON test_schema.events FOR EACH ROW EXECUTE FUNCTION test_schema.notify_event()`,
        ],
        expectedMasterDependencies: [],
        expectedBranchDependencies: [
          {
            dependent_stable_id: "sequence:test_schema.events_id_seq",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "sequence:test_schema.events_id_seq",
            referenced_stable_id: "table:test_schema.events",
            deptype: "n",
          },
          {
            dependent_stable_id: "function:test_schema.notify_event()",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "index:test_schema.events_pkey",
            referenced_stable_id: "constraint:test_schema.events.events_pkey",
            deptype: "i",
          },
          {
            dependent_stable_id: "table:test_schema.events",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "constraint:test_schema.events.events_pkey",
            referenced_stable_id: "table:test_schema.events",
            deptype: "a",
          },
          {
            dependent_stable_id:
              "trigger:test_schema.events.event_notification_trigger",
            referenced_stable_id: "function:test_schema.notify_event()",
            deptype: "n",
          },
          {
            dependent_stable_id:
              "trigger:test_schema.events.event_notification_trigger",
            referenced_stable_id: "table:test_schema.events",
            deptype: "n",
          },
        ],
      });
    });

    test("trigger semantic equality", async ({ db }) => {
      // Setup: Create a trigger in both databases
      await roundtripFidelityTest({
        masterSession: db.main,
        branchSession: db.branch,
        initialSetup: "CREATE SCHEMA test_schema",
        testSql: `
          CREATE TABLE test_schema.test_table (
            id serial PRIMARY KEY,
            value text
          );
          CREATE FUNCTION test_schema.test_func()
          RETURNS trigger
          LANGUAGE plpgsql
          AS 'BEGIN RETURN NEW; END;';
          CREATE TRIGGER test_trigger
          BEFORE INSERT ON test_schema.test_table
          FOR EACH ROW
          EXECUTE FUNCTION test_schema.test_func();
        `,
        description: "trigger semantic equality",
        expectedSqlTerms: [],
      });
    });

    test("trigger with dependencies roundtrip", async ({ db }) => {
      await roundtripFidelityTest({
        masterSession: db.main,
        branchSession: db.branch,
        initialSetup: "CREATE SCHEMA test_schema",
        testSql: `
          -- Create base table
          CREATE TABLE test_schema.orders (
            id serial PRIMARY KEY,
            customer_id integer NOT NULL,
            total_amount numeric(10,2),
            status text DEFAULT 'pending',
            created_at timestamp DEFAULT now(),
            updated_at timestamp DEFAULT now()
          );

          -- Create audit table
          CREATE TABLE test_schema.order_audit (
            id serial PRIMARY KEY,
            order_id integer,
            old_status text,
            new_status text,
            changed_at timestamp DEFAULT now()
          );

          -- Create trigger function for status changes
          CREATE FUNCTION test_schema.audit_order_status()
          RETURNS trigger
          LANGUAGE plpgsql
          AS $$
          BEGIN
            IF OLD.status IS DISTINCT FROM NEW.status THEN
              INSERT INTO test_schema.order_audit (order_id, old_status, new_status)
              VALUES (NEW.id, OLD.status, NEW.status);
            END IF;
            RETURN NEW;
          END;
          $$;

          -- Create trigger function for timestamp updates
          CREATE FUNCTION test_schema.update_order_timestamp()
          RETURNS trigger
          LANGUAGE plpgsql
          AS $$
          BEGIN
            NEW.updated_at = now();
            RETURN NEW;
          END;
          $$;

          -- Create triggers
          CREATE TRIGGER order_status_audit_trigger
          AFTER UPDATE ON test_schema.orders
          FOR EACH ROW
          WHEN (OLD.status IS DISTINCT FROM NEW.status)
          EXECUTE FUNCTION test_schema.audit_order_status();

          CREATE TRIGGER order_timestamp_trigger
          BEFORE UPDATE ON test_schema.orders
          FOR EACH ROW
          EXECUTE FUNCTION test_schema.update_order_timestamp();
        `,
        description: "Complex trigger scenario with multiple dependencies",
        expectedSqlTerms: [
          `CREATE TABLE test_schema.orders (id serial PRIMARY KEY, customer_id integer NOT NULL, total_amount numeric(10,2), status text DEFAULT 'pending', created_at timestamp DEFAULT now(), updated_at timestamp DEFAULT now())`,
          `CREATE TABLE test_schema.order_audit (id serial PRIMARY KEY, order_id integer, old_status text, new_status text, changed_at timestamp DEFAULT now())`,
          `CREATE OR REPLACE FUNCTION test_schema.audit_order_status() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ((OLD.status IS DISTINCT FROM NEW.status)) THEN INSERT INTO test_schema.order_audit (order_id, old_status, new_status) VALUES (NEW.id, OLD.status, NEW.status); END IF; RETURN NEW; END; $$`,
          `CREATE OR REPLACE FUNCTION test_schema.update_order_timestamp() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$`,
          `CREATE TRIGGER order_status_audit_trigger AFTER UPDATE ON test_schema.orders FOR EACH ROW WHEN ((old.status IS DISTINCT FROM new.status)) EXECUTE FUNCTION test_schema.audit_order_status()`,
          `CREATE TRIGGER order_timestamp_trigger BEFORE UPDATE ON test_schema.orders FOR EACH ROW EXECUTE FUNCTION test_schema.update_order_timestamp()`,
        ],
        expectedMasterDependencies: [],
        expectedBranchDependencies: [
          {
            dependent_stable_id: "sequence:test_schema.orders_id_seq",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "sequence:test_schema.orders_id_seq",
            referenced_stable_id: "table:test_schema.orders",
            deptype: "n",
          },
          {
            dependent_stable_id: "sequence:test_schema.order_audit_id_seq",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "sequence:test_schema.order_audit_id_seq",
            referenced_stable_id: "table:test_schema.order_audit",
            deptype: "n",
          },
          {
            dependent_stable_id: "function:test_schema.audit_order_status()",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id:
              "function:test_schema.update_order_timestamp()",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "index:test_schema.orders_pkey",
            referenced_stable_id: "constraint:test_schema.orders.orders_pkey",
            deptype: "i",
          },
          {
            dependent_stable_id: "constraint:test_schema.orders.orders_pkey",
            referenced_stable_id: "table:test_schema.orders",
            deptype: "a",
          },
          {
            dependent_stable_id: "index:test_schema.order_audit_pkey",
            referenced_stable_id:
              "constraint:test_schema.order_audit.order_audit_pkey",
            deptype: "i",
          },
          {
            dependent_stable_id:
              "constraint:test_schema.order_audit.order_audit_pkey",
            referenced_stable_id: "table:test_schema.order_audit",
            deptype: "a",
          },
          {
            dependent_stable_id: "table:test_schema.orders",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "table:test_schema.order_audit",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id:
              "trigger:test_schema.orders.order_status_audit_trigger",
            referenced_stable_id: "function:test_schema.audit_order_status()",
            deptype: "n",
          },
          {
            dependent_stable_id:
              "trigger:test_schema.orders.order_status_audit_trigger",
            referenced_stable_id: "table:test_schema.orders",
            deptype: "n",
          },
          {
            dependent_stable_id:
              "trigger:test_schema.orders.order_timestamp_trigger",
            referenced_stable_id:
              "function:test_schema.update_order_timestamp()",
            deptype: "n",
          },
          {
            dependent_stable_id:
              "trigger:test_schema.orders.order_timestamp_trigger",
            referenced_stable_id: "table:test_schema.orders",
            deptype: "n",
          },
        ],
      });
    });
  });
}
