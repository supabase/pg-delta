/**
 * Integration tests for PostgreSQL trigger operations.
 */

import { describe, expect, test } from "bun:test";
import dedent from "dedent";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { withDb } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  describe(`trigger operations (pg${pgVersion})`, () => {
    test(
      "INSTEAD OF triggers on views are diffed and ordered after view creation",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: "CREATE SCHEMA test_schema;",
          testSql: dedent`
            CREATE TABLE test_schema.users (
              id integer PRIMARY KEY,
              email text NOT NULL
            );

            CREATE VIEW test_schema.user_emails AS
              SELECT id, email FROM test_schema.users;

            CREATE OR REPLACE FUNCTION test_schema.insert_user_email()
            RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                INSERT INTO test_schema.users (id, email) VALUES (NEW.id, NEW.email);
                RETURN NEW;
            END;
            $$;

            CREATE OR REPLACE FUNCTION test_schema.update_user_email()
            RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                UPDATE test_schema.users SET email = NEW.email WHERE id = OLD.id;
                RETURN NEW;
            END;
            $$;

            CREATE TRIGGER user_emails_insert
                INSTEAD OF INSERT ON test_schema.user_emails
                FOR EACH ROW
                EXECUTE FUNCTION test_schema.insert_user_email();

            CREATE TRIGGER user_emails_update
                INSTEAD OF UPDATE ON test_schema.user_emails
                FOR EACH ROW
                EXECUTE FUNCTION test_schema.update_user_email();
          `,
          assertSqlStatements: (statements) => {
            expect(statements).toMatchInlineSnapshot(`
              [
                "SET check_function_bodies = false",
                
              "CREATE FUNCTION test_schema.insert_user_email()
               RETURNS trigger
               LANGUAGE plpgsql
              AS $function$
              BEGIN
                  INSERT INTO test_schema.users (id, email) VALUES (NEW.id, NEW.email);
                  RETURN NEW;
              END;
              $function$"
              ,
                
              "CREATE FUNCTION test_schema.update_user_email()
               RETURNS trigger
               LANGUAGE plpgsql
              AS $function$
              BEGIN
                  UPDATE test_schema.users SET email = NEW.email WHERE id = OLD.id;
                  RETURN NEW;
              END;
              $function$"
              ,
                "CREATE TABLE test_schema.users (id integer NOT NULL, email text NOT NULL)",
                "ALTER TABLE test_schema.users ADD CONSTRAINT users_pkey PRIMARY KEY (id)",
                
              "CREATE VIEW test_schema.user_emails AS SELECT ${pgVersion === 15 ? "users." : ""}id,
                  ${pgVersion === 15 ? "users." : ""}email
                 FROM test_schema.users"
              ,
                "CREATE TRIGGER user_emails_insert INSTEAD OF INSERT ON test_schema.user_emails FOR EACH ROW EXECUTE FUNCTION test_schema.insert_user_email()",
                "CREATE TRIGGER user_emails_update INSTEAD OF UPDATE ON test_schema.user_emails FOR EACH ROW EXECUTE FUNCTION test_schema.update_user_email()",
              ]
            `);
          },
        });
      }),
    );

    test(
      "simple trigger creation",
      withDb(pgVersion, async (db) => {
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
      }),
    );

    // Regression: CLI-1820. A trigger whose name must be double-quoted (it
    // contains a dash) had its formatted DDL mangled — the SQL formatter
    // dropped the "AFTER INSERT ON ..." event/table clause, producing invalid
    // migration SQL. The generated statement must keep the full clause.
    test(
      "trigger with a double-quoted (dashed) name keeps its event/table clause",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.t1 (
            id serial PRIMARY KEY,
            name text NOT NULL
          );
          CREATE FUNCTION test_schema.notify_change()
          RETURNS trigger
          LANGUAGE plpgsql
          AS $$
          BEGIN
            RETURN NEW;
          END;
          $$;
        `,
          testSql: `
          CREATE TRIGGER "new-webhook-with-dashed-name"
          AFTER INSERT ON test_schema.t1
          FOR EACH ROW
          EXECUTE FUNCTION test_schema.notify_change();
        `,
          assertSqlStatements: (statements) => {
            const triggerStatement = statements.find((statement) =>
              statement.includes('"new-webhook-with-dashed-name"'),
            );
            expect(triggerStatement).toContain(
              "AFTER INSERT ON test_schema.t1",
            );
          },
        });
      }),
    );

    test(
      "multi-event trigger",
      withDb(pgVersion, async (db) => {
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
      }),
    );

    test(
      "multi-event trigger preserves UPDATE OF column list",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: dedent`
            CREATE SCHEMA test_schema;

            CREATE TABLE test_schema.user_account (
              id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
              email text NOT NULL,
              verified boolean NOT NULL DEFAULT false
            );

            CREATE OR REPLACE FUNCTION test_schema.user_account_encrypt_secret_email()
            RETURNS trigger
            LANGUAGE plpgsql
            AS $$
            BEGIN
              NEW.email := 'enc:' || NEW.email;
              RETURN NEW;
            END;
            $$;
          `,
          testSql: dedent`
            CREATE OR REPLACE TRIGGER user_account_encrypt_secret_trigger_email
              BEFORE INSERT OR UPDATE OF email ON test_schema.user_account
              FOR EACH ROW
              EXECUTE FUNCTION test_schema.user_account_encrypt_secret_email();
          `,
          assertSqlStatements: (statements) => {
            expect(statements).toMatchInlineSnapshot(`
              [
                "CREATE TRIGGER user_account_encrypt_secret_trigger_email BEFORE INSERT OR UPDATE OF email ON test_schema.user_account FOR EACH ROW EXECUTE FUNCTION test_schema.user_account_encrypt_secret_email()",
              ]
            `);
            expect(statements[0]).not.toContain(
              "BEFORE INSERT OR UPDATE ON test_schema.user_account",
            );
          },
        });
      }),
    );

    test(
      "constraint trigger creation",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: dedent`
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.accounts (
            id serial PRIMARY KEY,
            amount integer NOT NULL,
            limit_amount integer NOT NULL
          );
          CREATE FUNCTION test_schema.enforce_amount_limit()
          RETURNS trigger
          LANGUAGE plpgsql
          AS $$
          BEGIN
            IF NEW.amount > NEW.limit_amount THEN
              RAISE EXCEPTION 'amount exceeds limit';
            END IF;
            RETURN NEW;
          END;
          $$;
        `,
          testSql: dedent`
          CREATE CONSTRAINT TRIGGER enforce_amount_limit_trigger
          AFTER INSERT OR UPDATE ON test_schema.accounts
          DEFERRABLE INITIALLY IMMEDIATE
          FOR EACH ROW
          EXECUTE FUNCTION test_schema.enforce_amount_limit();
        `,
        });
      }),
    );

    test(
      "constraint trigger update",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: dedent`
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.roles (
            id serial PRIMARY KEY,
            organization_id integer NOT NULL,
            project_ids integer[] NOT NULL
          );
          CREATE FUNCTION test_schema.role_and_project_ids_belong_to_org()
          RETURNS trigger
          LANGUAGE plpgsql
          AS $$
          BEGIN
            IF EXISTS (
              SELECT 1
              FROM unnest(NEW.project_ids) project_id
            ) THEN
              -- no-op: keep this function lightweight for the test
              NULL;
            END IF;
            RETURN NULL;
          END;
          $$;
          CREATE CONSTRAINT TRIGGER role_and_project_ids_belong_to_org
          AFTER INSERT OR UPDATE ON test_schema.roles
          FOR EACH ROW
          EXECUTE FUNCTION test_schema.role_and_project_ids_belong_to_org();
        `,
          testSql: dedent`
          DROP TRIGGER role_and_project_ids_belong_to_org ON test_schema.roles;

          CREATE CONSTRAINT TRIGGER role_and_project_ids_belong_to_org
          AFTER INSERT OR UPDATE ON test_schema.roles
          DEFERRABLE INITIALLY DEFERRED
          FOR EACH ROW
          EXECUTE FUNCTION test_schema.role_and_project_ids_belong_to_org();
        `,
        });
      }),
    );

    test(
      "constraint trigger deletion",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: dedent`
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.orders (
            id serial PRIMARY KEY,
            amount integer NOT NULL
          );
          CREATE FUNCTION test_schema.enforce_order_amount()
          RETURNS trigger
          LANGUAGE plpgsql
          AS $$
          BEGIN
            IF NEW.amount < 0 THEN
              RAISE EXCEPTION 'amount must be >= 0';
            END IF;
            RETURN NULL;
          END;
          $$;
          CREATE CONSTRAINT TRIGGER enforce_order_amount
          AFTER INSERT OR UPDATE ON test_schema.orders
          FOR EACH ROW
          EXECUTE FUNCTION test_schema.enforce_order_amount();
        `,
          testSql: `
          DROP TRIGGER enforce_order_amount ON test_schema.orders;
        `,
        });
      }),
    );

    test(
      "constraint trigger comment alteration",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: dedent`
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.accounts (
            id serial PRIMARY KEY,
            balance integer NOT NULL
          );
          CREATE FUNCTION test_schema.guard_balance()
          RETURNS trigger
          LANGUAGE plpgsql
          AS $$
          BEGIN
            IF NEW.balance < 0 THEN
              RAISE EXCEPTION 'balance must be >= 0';
            END IF;
            RETURN NULL;
          END;
          $$;
          CREATE CONSTRAINT TRIGGER guard_balance
          AFTER INSERT OR UPDATE ON test_schema.accounts
          FOR EACH ROW
          EXECUTE FUNCTION test_schema.guard_balance();
        `,
          testSql: `
          COMMENT ON TRIGGER guard_balance ON test_schema.accounts IS 'constraint trigger comment';
        `,
        });
      }),
    );

    test(
      "conditional trigger with WHEN clause",
      withDb(pgVersion, async (db) => {
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
      }),
    );

    test(
      "trigger dropping",
      withDb(pgVersion, async (db) => {
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
      }),
    );

    test(
      "trigger replacement (modification)",
      withDb(pgVersion, async (db) => {
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
      }),
    );

    test(
      "trigger after function dependency",
      withDb(pgVersion, async (db) => {
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
      }),
    );

    test(
      "drop trigger before dropping trigger function",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: dedent`
            CREATE SCHEMA test_schema;
            CREATE TABLE test_schema.foo (id integer PRIMARY KEY);
            CREATE FUNCTION test_schema.bar()
            RETURNS trigger
            LANGUAGE plpgsql
            AS $$
            BEGIN
              RETURN NULL;
            END;
            $$;
            CREATE TRIGGER foo_insert
            BEFORE INSERT ON test_schema.foo
            FOR EACH ROW
            EXECUTE FUNCTION test_schema.bar();
          `,
          testSql: dedent`
            DROP TRIGGER foo_insert ON test_schema.foo;
            DROP FUNCTION test_schema.bar();
          `,
        });
      }),
    );

    test(
      "drop all triggers before dropping shared trigger function",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: dedent`
            CREATE SCHEMA test_schema;
            CREATE TABLE test_schema.foo (id integer PRIMARY KEY);
            CREATE TABLE test_schema.bar (id integer PRIMARY KEY);
            CREATE FUNCTION test_schema.shared_trigger_fn()
            RETURNS trigger
            LANGUAGE plpgsql
            AS $$
            BEGIN
              RETURN NEW;
            END;
            $$;
            CREATE TRIGGER foo_insert
            BEFORE INSERT ON test_schema.foo
            FOR EACH ROW
            EXECUTE FUNCTION test_schema.shared_trigger_fn();
            CREATE TRIGGER bar_insert
            BEFORE INSERT ON test_schema.bar
            FOR EACH ROW
            EXECUTE FUNCTION test_schema.shared_trigger_fn();
          `,
          testSql: dedent`
            DROP TRIGGER foo_insert ON test_schema.foo;
            DROP TRIGGER bar_insert ON test_schema.bar;
            DROP FUNCTION test_schema.shared_trigger_fn();
          `,
        });
      }),
    );

    test(
      "trigger semantic equality",
      withDb(pgVersion, async (db) => {
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
      }),
    );

    test(
      "trigger with dependencies roundtrip",
      withDb(pgVersion, async (db) => {
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
      }),
    );

    test(
      "trigger comments",
      withDb(pgVersion, async (db) => {
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
      }),
    );

    // Assert that https://github.com/djrobstep/migra/issues/159 is working
    test(
      "hasura event trigger function introspection",
      withDb(pgVersion, async (db) => {
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
      }),

      // Test with a table, with a two columns, and a trigger that use the two in it's WHEN clause
      // Then one of the table column is dropped or when a column is added, what happen to the trigger ?
      // Eg: a trigger like so:
      // CREATE OR REPLACE FUNCTION post_activity_func()
      //     RETURNS TRIGGER
      // AS
      // $$
      // BEGIN
      //     IF TG_OP = 'UPDATE' AND (NOT NEW.draft OR (NOT OLD.draft AND NEW.draft)) -- (publish) OR (publish to draft)
      //     THEN
      //         INSERT INTO post_activity (
      //            id, context, creation_date, data, last_published_date, draft, growth, internet_link, title,
      //            todo, votes_average, brand_id, category_id, country_id, localisation_id, outcome_id, user_id,
      //            ability_id, strategy_id, opportunity_id, created_by, created_date, last_modified_by,
      //            last_modified_date, operation
      //         ) VALUES (OLD.*, 'UPDATE') ON CONFLICT ON CONSTRAINT post_activity_pkey DO NOTHING;

      //         RETURN NEW;
      //     ELSIF TG_OP = 'DELETE' THEN
      //         INSERT INTO post_activity (
      //             id, context, creation_date, data, last_published_date, draft, growth, internet_link, title,
      //             todo, votes_average, brand_id, category_id, country_id, localisation_id, outcome_id, user_id,
      //             ability_id, strategy_id, opportunity_id, created_by, created_date, last_modified_by,
      //             last_modified_date, operation
      //         ) VALUES (OLD.*, 'DELETE') ON CONFLICT ON CONSTRAINT post_activity_pkey DO NOTHING;
      //         RETURN OLD;
      //     ELSIF TG_OP = 'UPDATE' THEN
      //         RETURN NEW;
      //     END IF;
      // END;
      // $$
      // LANGUAGE plpgsql;
      // Then table is altered in the diff with something like this:
      // alter table post_activity add removed boolean default false;
      // If the trigger ins't updated to this, it will cause an error (probably):
      // CREATE OR REPLACE FUNCTION post_activity_func()
      //     RETURNS TRIGGER
      // AS
      // $$
      // BEGIN
      //     IF TG_OP = 'UPDATE' AND (NOT NEW.draft OR (NOT OLD.draft AND NEW.draft)) -- (publish) OR (publish to draft)
      //     THEN
      //         INSERT INTO post_activity (
      //            id, context, creation_date, data, last_published_date, draft, growth, internet_link, title,
      //            todo, votes_average, brand_id, category_id, country_id, localisation_id, outcome_id, user_id,
      //            ability_id, strategy_id, opportunity_id, created_by, created_date, last_modified_by,
      //            last_modified_date, removed, operation
      //         ) VALUES (OLD.*, 'UPDATE') ON CONFLICT ON CONSTRAINT post_activity_pkey DO NOTHING;

      //         RETURN NEW;
      //     ELSIF TG_OP = 'DELETE' THEN
      //         INSERT INTO post_activity (
      //             id, context, creation_date, data, last_published_date, draft, growth, internet_link, title,
      //             todo, votes_average, brand_id, category_id, country_id, localisation_id, outcome_id, user_id,
      //             ability_id, strategy_id, opportunity_id, created_by, created_date, last_modified_by,
      //             last_modified_date, removed, operation
      //         ) VALUES (OLD.*, 'DELETE') ON CONFLICT ON CONSTRAINT post_activity_pkey DO NOTHING;
      //         RETURN OLD;
      //     ELSIF TG_OP = 'UPDATE' THEN
      //         RETURN NEW;
      //     END IF;
      // END;
      // $$
      // LANGUAGE plpgsql;

      // Another test case, with tables with depending view that would cause an error if we use a `CREATE OR REPLACE` on the view rather than a DROP + CREATE:
      //       When a table gains a new column and a dependent view uses SELECT t.*, pgschema emits CREATE OR REPLACE VIEW which fails because PostgreSQL cannot rename existing view columns.

      // Reproduction
      // Given:

      // CREATE TABLE item (
      //   id uuid PRIMARY KEY,
      //   title text,
      //   status text
      // );

      // CREATE VIEW item_extended AS
      //   SELECT i.*, c.name AS category_name
      //   FROM item i JOIN category c ON ...;
      // Now add a column to the table:

      // -- In desired state SQL:
      // CREATE TABLE item (
      //   id uuid PRIMARY KEY,
      //   title text,
      //   status text,
      //   new_col text   -- added
      // );
      // pgschema detects item_extended needs updating (because i.* now includes new_col) and emits:

      // CREATE OR REPLACE VIEW item_extended AS
      //   SELECT i.*, c.name AS category_name FROM ...;
      // This fails with:

      // ERROR: cannot change name of view column "category_name" to "new_col" (SQLSTATE 42P16)
      // The i.* expansion now includes new_col before category_name, shifting column positions. PostgreSQL's CREATE OR REPLACE VIEW does not allow renaming existing columns.

      // Expected behavior
      // When a view's column set changes (not just the query body), pgschema should DROP VIEW + CREATE VIEW instead of CREATE OR REPLACE VIEW. This may require cascading drops for dependent views, which should be recreated afterward.

      // Impact
      // This blocks routine schema changes (adding columns to core tables) from being applied automatically. Any table referenced by views using SELECT * is affected.
    );
  });
}
