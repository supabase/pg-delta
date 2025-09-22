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
      });
    });

    test("trigger comments", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: dedent`
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.logs (
            id serial PRIMARY KEY,
            msg text,
            created_at timestamp DEFAULT now()
          );
          CREATE FUNCTION test_schema.log_insert()
          RETURNS trigger
          LANGUAGE plpgsql
          AS $$
          BEGIN
            RETURN NEW;
          END;
          $$;
          CREATE TRIGGER logs_insert_trigger
          BEFORE INSERT ON test_schema.logs
          FOR EACH ROW
          EXECUTE FUNCTION test_schema.log_insert();
        `,
        testSql: `
          COMMENT ON TRIGGER logs_insert_trigger ON test_schema.logs IS 'logs insert trigger';
        `,
      });
    });

    // Assert that https://github.com/djrobstep/migra/issues/159 is working
    test("hasura event trigger function introspection", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "",
        testSql: dedent`
          CREATE SCHEMA IF NOT EXISTS hdb_catalog;
          CREATE SCHEMA IF NOT EXISTS hdb_views;

          -- Minimal stub for Hasura's event log insertion function
          CREATE OR REPLACE FUNCTION hdb_catalog.insert_event_log(
            schema_name text,
            table_name text,
            trigger_name text,
            op text,
            data json
          ) RETURNS void
          LANGUAGE plpgsql
          AS $fn$
          BEGIN
            PERFORM 1;
          END;
          $fn$;

          CREATE FUNCTION hdb_views."notify_hasura_my_event_trigger_name_I"() RETURNS trigger
              LANGUAGE plpgsql
              AS $$
            DECLARE
              _old record;
              _new record;
              _data json;
            BEGIN
              IF TG_OP = 'UPDATE' THEN
                _old := row(OLD );
                _new := row(NEW );
              ELSE
              /* initialize _old and _new with dummy values for INSERT and UPDATE events*/
                _old := row((select 1));
                _new := row((select 1));
              END IF;
              _data := json_build_object(
                'old', NULL,
                'new', row_to_json(NEW )
              );
              BEGIN
                IF (TG_OP <> 'UPDATE') OR (_old <> _new) THEN
                  PERFORM hdb_catalog.insert_event_log(CAST(TG_TABLE_SCHEMA AS text), CAST(TG_TABLE_NAME AS text), CAST('my_event_trigger_name' AS text), TG_OP, _data);
                END IF;
                EXCEPTION WHEN undefined_function THEN
                  IF (TG_OP <> 'UPDATE') OR (_old *<> _new) THEN
                    PERFORM hdb_catalog.insert_event_log(CAST(TG_TABLE_SCHEMA AS text), CAST(TG_TABLE_NAME AS text), CAST('my_event_trigger_name' AS text), TG_OP, _data);
                  END IF;
              END;

              RETURN NULL;
            END;
          $$;
        `,
      });
    });
  });
}
