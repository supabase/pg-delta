/**
 * Integration tests for mixed database objects (schemas + tables).
 */

import { describe } from "vitest";
import type { Change } from "../../src/core/change.types.ts";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { getTest } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  const test = getTest(pgVersion);

  describe.concurrent(`mixed objects (pg${pgVersion})`, () => {
    test("schema and table creation", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "",
        testSql: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.users (
            id integer,
            name text NOT NULL,
            email text,
            created_at timestamp DEFAULT now()
          );
        `,
      });
    });

    test("multiple schemas and tables", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "",
        testSql: `
          CREATE SCHEMA core;
          CREATE SCHEMA analytics;

          CREATE TABLE core.users (
            id integer,
            username text NOT NULL,
            email text
          );

          CREATE TABLE core.posts (
            id integer,
            title text NOT NULL,
            content text,
            user_id integer
          );

          CREATE TABLE analytics.user_stats (
            user_id integer,
            post_count integer DEFAULT 0,
            last_login timestamp
          );
        `,
      });
    });

    test("complex column types", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "",
        testSql: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.complex_table (
            id uuid,
            metadata jsonb,
            tags text[],
            coordinates point,
            price numeric(10,2),
            is_active boolean DEFAULT true,
            created_at timestamptz DEFAULT now()
          );
        `,
      });
    });

    test("empty database", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "",
        testSql: "",
        expectedSqlTerms: [], // No SQL terms
        expectedMainDependencies: [], // Main has no dependencies (empty state)
        expectedBranchDependencies: [], // Branch has no dependencies (empty state)
      });
    });

    test("schema only", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "",
        testSql: "CREATE SCHEMA empty_schema;",
      });
    });

    test("e-commerce with sequences, tables, constraints, and indexes", async ({
      db,
    }) => {
      // TODO: fix this test, if we skip the dependencies checks we get a CycleError exception
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "",
        testSql: `
          CREATE SCHEMA ecommerce;

          -- Create customers table with SERIAL primary key
          CREATE TABLE ecommerce.customers (
            id SERIAL PRIMARY KEY,
            email VARCHAR(255) UNIQUE NOT NULL,
            first_name VARCHAR(100) NOT NULL,
            last_name VARCHAR(100) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );

          -- Create orders table with SERIAL primary key and foreign key
          CREATE TABLE ecommerce.orders (
            id SERIAL PRIMARY KEY,
            customer_id INTEGER NOT NULL,
            order_number VARCHAR(50) UNIQUE NOT NULL,
            status VARCHAR(20) DEFAULT 'pending',
            total_amount DECIMAL(10,2) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT fk_customer FOREIGN KEY (customer_id) REFERENCES ecommerce.customers(id)
          );

          -- Create index for common queries
          CREATE INDEX idx_orders_customer_status ON ecommerce.orders(customer_id, status);
          CREATE INDEX idx_customers_email ON ecommerce.customers(email);
        `,
      });
    });

    test("complex dependency ordering", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "CREATE SCHEMA test_schema",
        testSql: `
          -- Create base tables
          CREATE TABLE test_schema.users (
            id integer PRIMARY KEY,
            name text
          );

          CREATE TABLE test_schema.orders (
            id integer PRIMARY KEY,
            user_id integer,
            amount numeric
          );

          -- Create view that depends on both tables
          CREATE VIEW test_schema.user_orders AS
            SELECT u.id, u.name, SUM(o.amount) as total
            FROM test_schema.users u
            LEFT JOIN test_schema.orders o ON u.id = o.user_id
            GROUP BY u.id, u.name;

          -- Create view that depends on the first view
          CREATE VIEW test_schema.top_users AS
            SELECT * FROM test_schema.user_orders
            WHERE total > 1000;
        `,
        sortChangesCallback: (a, b) => {
          const priority = (change: Change) => {
            if (change.objectType === "view" && change.operation === "create") {
              const viewName = change.view?.name ?? "";
              return viewName === "top_users"
                ? 0
                : viewName === "user_orders"
                  ? 1
                  : 2;
            }
            return 3;
          };
          return priority(a) - priority(b);
        },
      });
    });

    test("drop operations with complex dependencies", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;

          -- Create a complex dependency chain
          CREATE TABLE test_schema.base (
            id integer PRIMARY KEY
          );

          CREATE VIEW test_schema.v1 AS SELECT * FROM test_schema.base;
          CREATE VIEW test_schema.v2 AS SELECT * FROM test_schema.v1;
          CREATE VIEW test_schema.v3 AS SELECT * FROM test_schema.v2;
        `,
        testSql: `
          -- Drop everything to test dependency ordering
          DROP VIEW test_schema.v3;
          DROP VIEW test_schema.v2;
          DROP VIEW test_schema.v1;
          DROP TABLE test_schema.base;
          DROP SCHEMA test_schema;
        `,
        sortChangesCallback: (a, b) => {
          const priority = (change: Change) => {
            if (change.objectType === "view" && change.operation === "drop") {
              const viewName = change.view?.name ?? "";
              return viewName === "v1"
                ? 0
                : viewName === "v2"
                  ? 1
                  : viewName === "v3"
                    ? 2
                    : 3;
            }
            if (change.objectType === "table" && change.operation === "drop") {
              return 4;
            }
            if (change.objectType === "schema" && change.operation === "drop") {
              return 5;
            }
            return 6;
          };
          return priority(a) - priority(b);
        },
      });
    });

    test("mixed create and replace operations", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;

          CREATE TABLE test_schema.data (
            id integer PRIMARY KEY,
            value text
          );

          CREATE VIEW test_schema.summary AS
            SELECT COUNT(*) as cnt FROM test_schema.data;
        `,
        testSql: `
          -- Add column and update view
          ALTER TABLE test_schema.data ADD COLUMN status text;

          CREATE OR REPLACE VIEW test_schema.summary AS
            SELECT COUNT(*) as cnt,
                   COUNT(CASE WHEN status = 'active' THEN 1 END) as active_cnt
            FROM test_schema.data;
        `,
        sortChangesCallback: (a, b) => {
          const priority = (change: Change) => {
            if (change.objectType === "view" && change.operation === "create") {
              return 0;
            }
            if (change.objectType === "table" && change.operation === "alter") {
              return 1;
            }
            return 2;
          };
          return priority(a) - priority(b);
        },
      });
    });

    test("cross-schema view dependencies", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA schema_a;
          CREATE SCHEMA schema_b;

          CREATE TABLE schema_a.table_a (id integer PRIMARY KEY);
          CREATE TABLE schema_b.table_b (id integer PRIMARY KEY);

          -- View in schema_a that references table in schema_b
          CREATE VIEW schema_a.cross_view AS
            SELECT a.id as a_id, b.id as b_id
            FROM schema_a.table_a a
            CROSS JOIN schema_b.table_b b;
        `,
        testSql: "", // No changes - just test dependency extraction
      });
    });

    test("basic table schema dependency validation", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "",
        testSql: `
          CREATE SCHEMA analytics;
          CREATE TABLE analytics.users (
            id integer,
            name text
          );
        `,
      });
    });

    test("multiple independent schema table pairs", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "",
        testSql: `
          CREATE SCHEMA app;
          CREATE SCHEMA analytics;
          CREATE TABLE app.users (id integer);
          CREATE TABLE analytics.reports (id integer);
        `,
      });
    });

    test("drop schema only", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA temp_schema;
        `,
        testSql: `
          DROP SCHEMA temp_schema;
        `,
      });
    });

    test("multiple drops with dependency ordering", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA app;
          CREATE SCHEMA analytics;
          CREATE TABLE app.users (id integer);
          CREATE TABLE analytics.reports (id integer);
        `,
        testSql: `
          DROP TABLE app.users;
          DROP TABLE analytics.reports;
          DROP SCHEMA app;
          DROP SCHEMA analytics;
        `,
      });
    });

    test("complex multi-schema drop scenario", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA core;
          CREATE SCHEMA analytics;
          CREATE SCHEMA reporting;
          CREATE TABLE core.users (id integer);
          CREATE TABLE analytics.events (id integer);
          CREATE TABLE reporting.summary (id integer);
        `,
        testSql: `
          DROP TABLE core.users;
          DROP TABLE analytics.events;
          DROP TABLE reporting.summary;
          DROP SCHEMA core;
          DROP SCHEMA analytics;
          DROP SCHEMA reporting;
        `,
      });
    });

    test("schema comments", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `CREATE SCHEMA test_schema;`,
        testSql: `
          COMMENT ON SCHEMA test_schema IS 'a test schema';
        `,
      });
    });

    test("enum modification with function dependencies - migra issue reproduction", async ({
      db,
    }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          -- Create initial enum type (similar to resource_type from the thread)
          CREATE TYPE test_schema.resource_type AS ENUM ('DiskIO', 'CPU', 'Memory', 'DiskSpace', 'MemoryAndSwap');
          
          -- Create tables that use the enum
          CREATE TABLE test_schema.exhaustion_email_events (
            id integer PRIMARY KEY,
            project_id bigint,
            resource_type test_schema.resource_type,
            inserted_at timestamp without time zone DEFAULT now()
          );
          
          CREATE TABLE test_schema.resource_exhaustion_notifications (
            id integer PRIMARY KEY,
            project_id bigint,
            resource_type test_schema.resource_type,
            inserted_at timestamp without time zone DEFAULT now()
          );
          
          -- Create functions that depend on the enum type (similar to the thread)
          CREATE OR REPLACE FUNCTION test_schema.get_user_resource_exhaustion_notifications_for_email(since timestamp without time zone)
           RETURNS TABLE(project_id bigint, resource_type test_schema.resource_type, latest_at timestamp without time zone, user_email text, project_name text, project_ref text)
           LANGUAGE plpgsql
          AS $function$
          begin
              -- Simplified version of the function from the thread
              return query
              select
                  ren.project_id,
                  ren.resource_type,
                  max(ren.inserted_at) as latest_at,
                  'test@example.com'::text as user_email,
                  'Test Project'::text as project_name,
                  'test-ref'::text as project_ref
              from resource_exhaustion_notifications ren
              where ren.inserted_at >= since
              group by ren.project_id, ren.resource_type;
          end;
          $function$;
          
          CREATE OR REPLACE FUNCTION test_schema.get_latest_user_resource_exhaustion_notifications(since timestamp with time zone)
           RETURNS TABLE(user_id bigint, project_id bigint, project_name text, project_ref text, resource_type test_schema.resource_type, latest_at timestamp without time zone, notification_name text)
           LANGUAGE plpgsql
          AS $function$
          begin
              return query
              select
                  1::bigint as user_id,
                  ren.project_id,
                  'Test Project'::text as project_name,
                  'test-ref'::text as project_ref,
                  ren.resource_type,
                  ren.inserted_at as latest_at,
                  ('Exhaust' || ren.resource_type)::text as notification_name
              from resource_exhaustion_notifications ren
              where ren.inserted_at >= since;
          end;
          $function$;
        `,
        testSql: `
          -- This simulates the problematic migration that migra generates:
          -- Adding new values to the enum type, which requires recreating the type
          -- and updating dependent functions. With pg-diff we are able to handle this
          -- because we are able to handle the ADD VALUE syntax
          ALTER TYPE test_schema.resource_type ADD VALUE 'AuthRateLimit';
          ALTER TYPE test_schema.resource_type ADD VALUE 'Connections';
          ALTER TYPE test_schema.resource_type ADD VALUE 'PgBouncerPool';
          ALTER TYPE test_schema.resource_type ADD VALUE 'TempFiles';
        `,
      });
    });

    test("enum modification with complex function dependencies", async ({
      db,
    }) => {
      // Test a more complex scenario with multiple functions and tables depending on enum
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          -- Create enum type
          CREATE TYPE test_schema.order_status AS ENUM ('pending', 'processing', 'shipped');
          
          -- Create tables
          CREATE TABLE test_schema.orders (
            id integer PRIMARY KEY,
            status test_schema.order_status DEFAULT 'pending',
            customer_id integer,
            total_amount numeric(10,2)
          );
          
          CREATE TABLE test_schema.order_history (
            id integer PRIMARY KEY,
            order_id integer,
            old_status test_schema.order_status,
            new_status test_schema.order_status,
            changed_at timestamp DEFAULT now()
          );
          
          -- Create functions that depend on the enum
          CREATE OR REPLACE FUNCTION test_schema.get_orders_by_status(status_filter test_schema.order_status)
           RETURNS TABLE(order_id integer, customer_id integer, total_amount numeric)
           LANGUAGE plpgsql
          AS $function$
          begin
              return query
              select o.id, o.customer_id, o.total_amount
              from orders o
              where o.status = status_filter;
          end;
          $function$;
          
          CREATE OR REPLACE FUNCTION test_schema.update_order_status(order_id integer, new_status test_schema.order_status)
           RETURNS boolean
           LANGUAGE plpgsql
          AS $function$
          declare
              old_status_val test_schema.order_status;
          begin
              select status into old_status_val from orders where id = order_id;
              if old_status_val is null then
                  return false;
              end if;
              
              update orders set status = new_status where id = order_id;
              insert into order_history (order_id, old_status, new_status) 
              values (order_id, old_status_val, new_status);
              
              return true;
          end;
          $function$;
          
          CREATE OR REPLACE FUNCTION test_schema.get_status_transitions()
           RETURNS TABLE(from_status test_schema.order_status, to_status test_schema.order_status, count bigint)
           LANGUAGE plpgsql
          AS $function$
          begin
              return query
              select oh.old_status, oh.new_status, count(*)::bigint
              from order_history oh
              group by oh.old_status, oh.new_status
              order by count(*) desc;
          end;
          $function$;
        `,
        testSql: `
          -- Add new enum values
          ALTER TYPE test_schema.order_status ADD VALUE 'delivered';
          ALTER TYPE test_schema.order_status ADD VALUE 'cancelled';
          ALTER TYPE test_schema.order_status ADD VALUE 'returned';
        `,
      });
    });

    test("enum modification with view dependencies", async ({ db }) => {
      // Test enum modification when views depend on the enum
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          -- Create enum type
          CREATE TYPE test_schema.user_role AS ENUM ('admin', 'user', 'moderator');
          
          -- Create table
          CREATE TABLE test_schema.users (
            id integer PRIMARY KEY,
            username text,
            role test_schema.user_role DEFAULT 'user',
            created_at timestamp DEFAULT now()
          );
          
          -- Create views that depend on the enum
          CREATE VIEW test_schema.admin_users AS
          SELECT id, username, created_at
          FROM test_schema.users
          WHERE role = 'admin'::test_schema.user_role;
          
          CREATE VIEW test_schema.user_role_stats AS
          SELECT 
            role,
            count(*) as user_count,
            min(created_at) as first_user,
            max(created_at) as latest_user
          FROM test_schema.users
          GROUP BY role;
          
          CREATE VIEW test_schema.role_permissions AS
          SELECT 
            role,
            CASE 
              WHEN role = 'admin'::test_schema.user_role THEN 'full_access'
              WHEN role = 'moderator'::test_schema.user_role THEN 'limited_access'
              ELSE 'basic_access'
            END as permission_level
          FROM test_schema.users
          GROUP BY role;
        `,
        testSql: `
          -- Add new enum values
          ALTER TYPE test_schema.user_role ADD VALUE 'super_admin';
          ALTER TYPE test_schema.user_role ADD VALUE 'guest';
        `,
      });
    });

    test("enum value removal with function dependencies", async ({ db }) => {
      // Test removing enum values when functions depend on them
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          -- Create enum type with multiple values
          CREATE TYPE test_schema.status AS ENUM ('active', 'inactive', 'pending', 'archived', 'deleted');
          
          -- Create table using the enum
          CREATE TABLE test_schema.records (
            id integer PRIMARY KEY,
            name text,
            status test_schema.status DEFAULT 'pending',
            created_at timestamp DEFAULT now()
          );
          
          -- Create function that depends on specific enum values
          CREATE OR REPLACE FUNCTION test_schema.get_active_records()
           RETURNS TABLE(record_id integer, record_name text, record_status test_schema.status)
           LANGUAGE plpgsql
          AS $function$
          begin
              return query
              select r.id, r.name, r.status
              from records r
              where r.status in ('active', 'pending');
          end;
          $function$;
          
          CREATE OR REPLACE FUNCTION test_schema.archive_record(record_id integer)
           RETURNS boolean
           LANGUAGE plpgsql
          AS $function$
          declare
              current_status test_schema.status;
          begin
              select status into current_status from records where id = record_id;
              if current_status is null then
                  return false;
              end if;
              
              -- Only allow archiving from active or inactive status
              if current_status not in ('active', 'inactive') then
                  return false;
              end if;
              
              update records set status = 'archived' where id = record_id;
              return true;
          end;
          $function$;
          
          CREATE OR REPLACE FUNCTION test_schema.get_status_counts()
           RETURNS TABLE(status_name test_schema.status, count bigint)
           LANGUAGE plpgsql
          AS $function$
          begin
              return query
              select r.status, count(*)::bigint
              from records r
              group by r.status
              order by r.status;
          end;
          $function$;
        `,
        testSql: `
          -- Remove specific enum values that are no longer needed
          -- Note: PostgreSQL doesn't support direct removal of enum values,
          -- so this would typically require recreating the type and updating dependencies
          -- This test verifies that pg-diff can handle the recreation scenario
          DROP TYPE test_schema.status CASCADE;
          CREATE TYPE test_schema.status AS ENUM ('active', 'inactive', 'archived');
          
          -- Recreate the table with the new enum (CASCADE should have dropped it, but let's be safe)
          DROP TABLE IF EXISTS test_schema.records CASCADE;
          CREATE TABLE test_schema.records (
            id integer PRIMARY KEY,
            name text,
            status test_schema.status DEFAULT 'active',
            created_at timestamp DEFAULT now()
          );
          
          -- Recreate functions with updated enum references
          CREATE OR REPLACE FUNCTION test_schema.get_active_records()
           RETURNS TABLE(record_id integer, record_name text, record_status test_schema.status)
           LANGUAGE plpgsql
          AS $function$
          begin
              return query
              select r.id, r.name, r.status
              from records r
              where r.status = 'active';
          end;
          $function$;
          
          CREATE OR REPLACE FUNCTION test_schema.archive_record(record_id integer)
           RETURNS boolean
           LANGUAGE plpgsql
          AS $function$
          declare
              current_status test_schema.status;
          begin
              select status into current_status from records where id = record_id;
              if current_status is null then
                  return false;
              end if;
              
              -- Only allow archiving from active status
              if current_status != 'active' then
                  return false;
              end if;
              
              update records set status = 'archived' where id = record_id;
              return true;
          end;
          $function$;
          
          CREATE OR REPLACE FUNCTION test_schema.get_status_counts()
           RETURNS TABLE(status_name test_schema.status, count bigint)
           LANGUAGE plpgsql
          AS $function$
          begin
              return query
              select r.status, count(*)::bigint
              from records r
              group by r.status
              order by r.status;
          end;
          $function$;
        `,
      });
    });

    test("enum value removal with table and view dependencies", async ({
      db,
    }) => {
      // Test removing enum values when tables and views depend on them
      // Those will need global dependencies where types are changed before anything else is changed
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          -- Create enum type with multiple values
          CREATE TYPE test_schema.priority AS ENUM ('low', 'medium', 'high', 'critical', 'urgent', 'blocked');
          
          -- Create tables using the enum
          CREATE TABLE test_schema.tasks (
            id integer PRIMARY KEY,
            title text,
            priority test_schema.priority DEFAULT 'medium',
            assigned_to text,
            created_at timestamp DEFAULT now()
          );
          
          CREATE TABLE test_schema.task_history (
            id integer PRIMARY KEY,
            task_id integer,
            old_priority test_schema.priority,
            new_priority test_schema.priority,
            changed_at timestamp DEFAULT now()
          );
          
          -- Create views that depend on the enum
          CREATE VIEW test_schema.high_priority_tasks AS
          SELECT id, title, assigned_to, created_at
          FROM test_schema.tasks
          WHERE priority IN ('high', 'critical', 'urgent');
          
          CREATE VIEW test_schema.priority_distribution AS
          SELECT 
            priority,
            count(*) as task_count,
            min(created_at) as oldest_task,
            max(created_at) as newest_task
          FROM test_schema.tasks
          GROUP BY priority
          ORDER BY 
            CASE priority
              WHEN 'critical' THEN 1
              WHEN 'urgent' THEN 2
              WHEN 'high' THEN 3
              WHEN 'medium' THEN 4
              WHEN 'low' THEN 5
              WHEN 'blocked' THEN 6
            END;
          
          CREATE VIEW test_schema.task_priority_changes AS
          SELECT 
            th.task_id,
            t.title,
            th.old_priority,
            th.new_priority,
            th.changed_at
          FROM test_schema.task_history th
          JOIN test_schema.tasks t ON th.task_id = t.id
          WHERE th.old_priority != th.new_priority;
        `,
        testSql: `
          -- Remove some enum values by recreating the type
          DROP TYPE test_schema.priority CASCADE;
          CREATE TYPE test_schema.priority AS ENUM ('low', 'medium', 'high', 'critical');
          
          -- Recreate tables with the simplified enum (CASCADE should have dropped them, but let's be safe)
          DROP TABLE IF EXISTS test_schema.tasks CASCADE;
          DROP TABLE IF EXISTS test_schema.task_history CASCADE;
          CREATE TABLE test_schema.tasks (
            id integer PRIMARY KEY,
            title text,
            priority test_schema.priority DEFAULT 'medium',
            assigned_to text,
            created_at timestamp DEFAULT now()
          );
          
          CREATE TABLE test_schema.task_history (
            id integer PRIMARY KEY,
            task_id integer,
            old_priority test_schema.priority,
            new_priority test_schema.priority,
            changed_at timestamp DEFAULT now()
          );
          
          -- Recreate views with updated enum references
          CREATE VIEW test_schema.high_priority_tasks AS
          SELECT id, title, assigned_to, created_at
          FROM test_schema.tasks
          WHERE priority IN ('high', 'critical');
          
          CREATE VIEW test_schema.priority_distribution AS
          SELECT 
            priority,
            count(*) as task_count,
            min(created_at) as oldest_task,
            max(created_at) as newest_task
          FROM test_schema.tasks
          GROUP BY priority
          ORDER BY 
            CASE priority
              WHEN 'critical' THEN 1
              WHEN 'high' THEN 2
              WHEN 'medium' THEN 3
              WHEN 'low' THEN 4
            END;
          
          CREATE VIEW test_schema.task_priority_changes AS
          SELECT 
            th.task_id,
            t.title,
            th.old_priority,
            th.new_priority,
            th.changed_at
          FROM test_schema.task_history th
          JOIN test_schema.tasks t ON th.task_id = t.id
          WHERE th.old_priority != th.new_priority;
        `,
      });
    });

    test("enum value removal with complex function dependencies", async ({
      db,
    }) => {
      // Test removing enum values with complex function dependencies
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          -- Create enum type with many values
          CREATE TYPE test_schema.user_state AS ENUM (
            'new', 'verified', 'active', 'suspended', 'banned', 
            'pending_verification', 'inactive', 'deleted'
          );
          
          -- Create table using the enum
          CREATE TABLE test_schema.users (
            id integer PRIMARY KEY,
            username text,
            email text,
            state test_schema.user_state DEFAULT 'new',
            created_at timestamp DEFAULT now(),
            updated_at timestamp DEFAULT now()
          );
          
          -- Create complex functions that depend on the enum
          CREATE OR REPLACE FUNCTION test_schema.get_users_by_state(state_filter test_schema.user_state)
           RETURNS TABLE(user_id integer, username text, email text, state test_schema.user_state)
           LANGUAGE plpgsql
          AS $function$
          begin
              return query
              select u.id, u.username, u.email, u.state
              from users u
              where u.state = state_filter;
          end;
          $function$;
          
          CREATE OR REPLACE FUNCTION test_schema.transition_user_state(
            user_id integer, 
            new_state test_schema.user_state
          )
           RETURNS boolean
           LANGUAGE plpgsql
          AS $function$
          declare
              current_state test_schema.user_state;
              valid_transition boolean := false;
          begin
              select state into current_state from users where id = user_id;
              if current_state is null then
                  return false;
              end if;
              
              -- Define valid state transitions
              valid_transition := (
                (current_state = 'new' and new_state in ('verified', 'pending_verification', 'deleted')) or
                (current_state = 'pending_verification' and new_state in ('verified', 'deleted')) or
                (current_state = 'verified' and new_state in ('active', 'suspended', 'deleted')) or
                (current_state = 'active' and new_state in ('suspended', 'inactive', 'deleted')) or
                (current_state = 'suspended' and new_state in ('active', 'banned', 'deleted')) or
                (current_state = 'inactive' and new_state in ('active', 'deleted')) or
                (current_state = 'banned' and new_state in ('deleted'))
              );
              
              if not valid_transition then
                  return false;
              end if;
              
              update users set state = new_state, updated_at = now() where id = user_id;
              return true;
          end;
          $function$;
          
          CREATE OR REPLACE FUNCTION test_schema.get_user_state_stats()
           RETURNS TABLE(
             state_name test_schema.user_state, 
             user_count bigint,
             percentage numeric
           )
           LANGUAGE plpgsql
          AS $function$
          declare
              total_users bigint;
          begin
              select count(*) into total_users from users;
              
              return query
              select 
                u.state,
                count(*)::bigint as user_count,
                round((count(*)::numeric / total_users::numeric) * 100, 2) as percentage
              from users u
              group by u.state
              order by count(*) desc;
          end;
          $function$;
          
          CREATE OR REPLACE FUNCTION test_schema.is_user_active(user_id integer)
           RETURNS boolean
           LANGUAGE plpgsql
          AS $function$
          declare
              user_state test_schema.user_state;
          begin
              select state into user_state from users where id = user_id;
              if user_state is null then
                  return false;
              end if;
              
              return user_state in ('active', 'verified');
          end;
          $function$;
        `,
        testSql: `
          -- Remove some enum values by recreating the type with fewer values
          DROP TYPE test_schema.user_state CASCADE;
          CREATE TYPE test_schema.user_state AS ENUM (
            'new', 'active', 'suspended', 'banned', 'deleted'
          );
          
          -- Recreate table with simplified enum (CASCADE should have dropped it, but let's be safe)
          DROP TABLE IF EXISTS test_schema.users CASCADE;
          CREATE TABLE test_schema.users (
            id integer PRIMARY KEY,
            username text,
            email text,
            state test_schema.user_state DEFAULT 'new',
            created_at timestamp DEFAULT now(),
            updated_at timestamp DEFAULT now()
          );
          
          -- Recreate functions with updated enum references
          CREATE OR REPLACE FUNCTION test_schema.get_users_by_state(state_filter test_schema.user_state)
           RETURNS TABLE(user_id integer, username text, email text, state test_schema.user_state)
           LANGUAGE plpgsql
          AS $function$
          begin
              return query
              select u.id, u.username, u.email, u.state
              from users u
              where u.state = state_filter;
          end;
          $function$;
          
          CREATE OR REPLACE FUNCTION test_schema.transition_user_state(
            user_id integer, 
            new_state test_schema.user_state
          )
           RETURNS boolean
           LANGUAGE plpgsql
          AS $function$
          declare
              current_state test_schema.user_state;
              valid_transition boolean := false;
          begin
              select state into current_state from users where id = user_id;
              if current_state is null then
                  return false;
              end if;
              
              -- Simplified state transitions
              valid_transition := (
                (current_state = 'new' and new_state in ('active', 'deleted')) or
                (current_state = 'active' and new_state in ('suspended', 'banned', 'deleted')) or
                (current_state = 'suspended' and new_state in ('active', 'banned', 'deleted')) or
                (current_state = 'banned' and new_state in ('deleted'))
              );
              
              if not valid_transition then
                  return false;
              end if;
              
              update users set state = new_state, updated_at = now() where id = user_id;
              return true;
          end;
          $function$;
          
          CREATE OR REPLACE FUNCTION test_schema.get_user_state_stats()
           RETURNS TABLE(
             state_name test_schema.user_state, 
             user_count bigint,
             percentage numeric
           )
           LANGUAGE plpgsql
          AS $function$
          declare
              total_users bigint;
          begin
              select count(*) into total_users from users;
              
              return query
              select 
                u.state,
                count(*)::bigint as user_count,
                round((count(*)::numeric / total_users::numeric) * 100, 2) as percentage
              from users u
              group by u.state
              order by count(*) desc;
          end;
          $function$;
          
          CREATE OR REPLACE FUNCTION test_schema.is_user_active(user_id integer)
           RETURNS boolean
           LANGUAGE plpgsql
          AS $function$
          declare
              user_state test_schema.user_state;
          begin
              select state into user_state from users where id = user_id;
              if user_state is null then
                  return false;
              end if;
              
              return user_state = 'active';
          end;
          $function$;
        `,
      });
    });

    test.todo("enum modification with check constraints", async ({ db }) => {
      // Test enum modification when check constraints depend on the enum
      // TODO: this one is skipped because it require a two step transaction to be executed
      // with a COMMIT in between so might be out of the scope of a diff-er
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          -- Create enum type
          CREATE TYPE test_schema.priority_level AS ENUM ('low', 'medium', 'high');
          
          -- Create table with check constraint using enum
          CREATE TABLE test_schema.tasks (
            id integer PRIMARY KEY,
            title text,
            priority test_schema.priority_level DEFAULT 'medium',
            due_date date,
            CONSTRAINT valid_priority CHECK (priority IN ('low', 'medium', 'high'))
          );
          
          -- Create function that validates priority
          CREATE OR REPLACE FUNCTION test_schema.validate_task_priority(task_priority test_schema.priority_level)
           RETURNS boolean
           LANGUAGE plpgsql
          AS $function$
          begin
              return task_priority in ('low', 'medium', 'high');
          end;
          $function$;
        `,
        testSql: `
          -- First transaction: Add enum values
          ALTER TYPE test_schema.priority_level ADD VALUE 'urgent';
          ALTER TYPE test_schema.priority_level ADD VALUE 'critical';
          COMMIT;
          -- Second transaction: Update constraints and functions
          ALTER TABLE test_schema.tasks DROP CONSTRAINT valid_priority;
          ALTER TABLE test_schema.tasks ADD CONSTRAINT valid_priority 
            CHECK (priority IN ('low', 'medium', 'high', 'urgent', 'critical'));

          CREATE OR REPLACE FUNCTION test_schema.validate_task_priority(task_priority test_schema.priority_level)
          RETURNS boolean
          LANGUAGE plpgsql
          AS $function$
          begin
              return task_priority in ('low', 'medium', 'high', 'urgent', 'critical');
          end;
          $function$;
        `,
      });
    });
  });
}
