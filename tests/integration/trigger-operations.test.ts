/**
 * Integration tests for PostgreSQL trigger operations.
 */

import dedent from "dedent";
import { describe } from "vitest";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { getTest } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  const test = getTest(pgVersion);

  describe.concurrent(`trigger operations (pg${pgVersion})`, () => {
    test("simple trigger creation", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
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
        expectedMainDependencies: [
          {
            dependent_stable_id: "procedure:test_schema.update_timestamp()",
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
            deptype: "a",
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
            dependent_stable_id: "procedure:test_schema.update_timestamp()",
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
            deptype: "a",
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
            referenced_stable_id: "procedure:test_schema.update_timestamp()",
            deptype: "n",
          },
          {
            dependent_stable_id:
              "trigger:test_schema.users.update_timestamp_trigger",
            referenced_stable_id: "table:test_schema.users",
            deptype: "a",
          },
        ],
      });
    });

    test("multi-event trigger", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
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
        testSql:
          "CREATE TRIGGER audit_trigger AFTER INSERT OR DELETE OR UPDATE ON test_schema.sensitive_data FOR EACH ROW EXECUTE FUNCTION test_schema.audit_changes();",
        description: "multi-event trigger",
        expectedMainDependencies: [
          {
            dependent_stable_id: "procedure:test_schema.audit_changes()",
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
            deptype: "a",
          },
          {
            dependent_stable_id: "sequence:test_schema.sensitive_data_id_seq",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "sequence:test_schema.sensitive_data_id_seq",
            referenced_stable_id: "table:test_schema.sensitive_data",
            deptype: "a",
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
            dependent_stable_id: "procedure:test_schema.audit_changes()",
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
            deptype: "a",
          },
          {
            dependent_stable_id: "sequence:test_schema.sensitive_data_id_seq",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "sequence:test_schema.sensitive_data_id_seq",
            referenced_stable_id: "table:test_schema.sensitive_data",
            deptype: "a",
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
            referenced_stable_id: "procedure:test_schema.audit_changes()",
            deptype: "n",
          },
          {
            dependent_stable_id:
              "trigger:test_schema.sensitive_data.audit_trigger",
            referenced_stable_id: "table:test_schema.sensitive_data",
            deptype: "a",
          },
        ],
      });
    });

    test("conditional trigger with WHEN clause", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
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
          "CREATE TRIGGER price_change_trigger AFTER UPDATE ON test_schema.products FOR EACH ROW WHEN (old.price IS DISTINCT FROM new.price) EXECUTE FUNCTION test_schema.log_price_changes()",
        ],
        expectedMainDependencies: [
          {
            dependent_stable_id: "procedure:test_schema.log_price_changes()",
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
            deptype: "a",
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
            dependent_stable_id: "procedure:test_schema.log_price_changes()",
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
            deptype: "a",
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
            referenced_stable_id: "procedure:test_schema.log_price_changes()",
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
        mainSession: db.main,
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
        expectedMainDependencies: [
          {
            dependent_stable_id: "procedure:test_schema.test_trigger_func()",
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
            deptype: "a",
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
            referenced_stable_id: "procedure:test_schema.test_trigger_func()",
            deptype: "n",
          },
          {
            dependent_stable_id: "trigger:test_schema.test_table.old_trigger",
            referenced_stable_id: "table:test_schema.test_table",
            deptype: "a",
          },
        ],
        expectedBranchDependencies: [
          {
            dependent_stable_id: "procedure:test_schema.test_trigger_func()",
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
            deptype: "a",
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
        mainSession: db.main,
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
        testSql: dedent`
          CREATE OR REPLACE FUNCTION test_schema.validate_email()
           RETURNS trigger
           LANGUAGE plpgsql
          AS $function$
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
          $function$;

          DROP TRIGGER email_validation_trigger ON test_schema.users;

          CREATE TRIGGER email_validation_trigger
          BEFORE INSERT OR UPDATE ON test_schema.users
          FOR EACH ROW
          EXECUTE FUNCTION test_schema.validate_email();
        `,
        description: "trigger replacement (modification)",
        expectedSqlTerms: [
          dedent`
            CREATE OR REPLACE FUNCTION test_schema.validate_email()
             RETURNS trigger
             LANGUAGE plpgsql
            AS $function$
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
            $function$`,
          `CREATE OR REPLACE TRIGGER email_validation_trigger BEFORE INSERT OR UPDATE ON test_schema.users FOR EACH ROW EXECUTE FUNCTION test_schema.validate_email()`,
        ],
        expectedMainDependencies: [
          {
            dependent_stable_id: "procedure:test_schema.validate_email()",
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
            deptype: "a",
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
            referenced_stable_id: "procedure:test_schema.validate_email()",
            deptype: "n",
          },
          {
            dependent_stable_id:
              "trigger:test_schema.users.email_validation_trigger",
            referenced_stable_id: "table:test_schema.users",
            deptype: "a",
          },
        ],
        expectedBranchDependencies: [
          {
            dependent_stable_id: "procedure:test_schema.validate_email()",
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
            deptype: "a",
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
            referenced_stable_id: "procedure:test_schema.validate_email()",
            deptype: "n",
          },
          {
            dependent_stable_id:
              "trigger:test_schema.users.email_validation_trigger",
            referenced_stable_id: "table:test_schema.users",
            deptype: "a",
          },
        ],
      });
    });

    test("trigger after function dependency", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "CREATE SCHEMA test_schema",
        testSql: dedent`
          CREATE TABLE test_schema.events (
            id serial PRIMARY KEY,
            event_type text,
            occurred_at timestamp DEFAULT now()
          );

          CREATE FUNCTION test_schema.notify_event()
           RETURNS trigger
           LANGUAGE plpgsql
          AS $function$
          BEGIN
            PERFORM pg_notify('event_occurred', NEW.event_type);
            RETURN NEW;
          END;
          $function$;

          CREATE TRIGGER event_notification_trigger
          AFTER INSERT ON test_schema.events
          FOR EACH ROW
          EXECUTE FUNCTION test_schema.notify_event();
        `,
        description: "trigger after function dependency",
      });
    });

    test("trigger semantic equality", async ({ db }) => {
      // Setup: Create a trigger in both databases
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `CREATE SCHEMA test_schema
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
        EXECUTE FUNCTION test_schema.test_func();`,
        description: "trigger semantic equality",
        expectedSqlTerms: [],
      });
    });

    test("trigger with dependencies roundtrip", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "CREATE SCHEMA test_schema",
        testSql: dedent`
          CREATE TABLE test_schema.orders (
            id serial PRIMARY KEY,
            customer_id integer NOT NULL,
            total_amount numeric(10,2),
            status text DEFAULT 'pending',
            created_at timestamp DEFAULT now(),
            updated_at timestamp DEFAULT now()
          );

          CREATE TABLE test_schema.order_audit (
            id serial PRIMARY KEY,
            order_id integer,
            old_status text,
            new_status text,
            changed_at timestamp DEFAULT now()
          );

          CREATE FUNCTION test_schema.audit_order_status()
           RETURNS trigger
           LANGUAGE plpgsql
          AS $function$
          BEGIN
            IF OLD.status IS DISTINCT FROM NEW.status THEN
              INSERT INTO test_schema.order_audit (order_id, old_status, new_status)
              VALUES (NEW.id, OLD.status, NEW.status);
            END IF;
            RETURN NEW;
          END;
          $function$;

          CREATE FUNCTION test_schema.update_order_timestamp()
           RETURNS trigger
           LANGUAGE plpgsql
          AS $function$
          BEGIN
            NEW.updated_at = now();
            RETURN NEW;
          END;
          $function$;

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
      });
    });
  });
}
