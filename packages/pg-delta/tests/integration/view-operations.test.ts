/**
 * Integration tests for PostgreSQL view operations.
 */

import { describe, expect, test } from "bun:test";
import { createPlan } from "../../src/core/plan/create.ts";
import { flattenPlanStatements } from "../../src/core/plan/render.ts";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { withDb, withDbIsolated } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  describe(`view operations (pg${pgVersion})`, () => {
    test(
      "simple view creation",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: "CREATE SCHEMA test_schema;",
          testSql: `
          CREATE TABLE test_schema.users (
            id integer,
            name text,
            email text
          );

          CREATE VIEW test_schema.active_users AS
          SELECT id, name, email
          FROM test_schema.users
          WHERE email IS NOT NULL;
        `,
        });
      }),
    );

    test(
      "nested view dependencies - 3 levels deep",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: "CREATE SCHEMA test_schema;",
          testSql: `
          CREATE TABLE test_schema.users (
            id integer,
            name text,
            email text,
            created_at timestamp DEFAULT NOW()
          );

          CREATE TABLE test_schema.orders (
            id integer,
            user_id integer,
            amount decimal(10,2),
            created_at timestamp DEFAULT NOW()
          );

          -- Level 1: Views directly on tables
          CREATE VIEW test_schema.recent_users AS
          SELECT id, name, email, created_at
          FROM test_schema.users
          WHERE created_at > NOW() - INTERVAL '30 days';

          CREATE VIEW test_schema.high_value_orders AS
          SELECT id, user_id, amount, created_at
          FROM test_schema.orders
          WHERE amount > 100;

          -- Level 2: Views on other views
          CREATE VIEW test_schema.recent_big_spenders AS
          SELECT u.id, u.name, u.email, COUNT(o.id) as order_count, SUM(o.amount) as total_spent
          FROM test_schema.recent_users u
          JOIN test_schema.high_value_orders o ON u.id = o.user_id
          GROUP BY u.id, u.name, u.email;

          -- Level 3: Views on views of views
          CREATE VIEW test_schema.top_customers AS
          SELECT id, name, email, total_spent
          FROM test_schema.recent_big_spenders
          WHERE total_spent > 1000
          ORDER BY total_spent DESC
          LIMIT 10;
        `,
        });
      }),
    );

    test(
      "view replacement with dependency changes",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA test_schema;

          CREATE TABLE test_schema.users (
            id integer,
            name text,
            status text
          );

          CREATE TABLE test_schema.profiles (
            user_id integer,
            bio text,
            avatar_url text
          );

          CREATE VIEW test_schema.user_summary AS
          SELECT id, name, status
          FROM test_schema.users;
        `,
          testSql: `
          -- Replace view to include profile data (new dependency)
          CREATE OR REPLACE VIEW test_schema.user_summary AS
          SELECT u.id, u.name, u.status, p.bio, p.avatar_url
          FROM test_schema.users u
          LEFT JOIN test_schema.profiles p ON u.id = p.user_id;
        `,
        });
      }),
    );

    test(
      "recreates select-star view when base table columns change",
      withDb(pgVersion, async (db) => {
        const initialSetup = `
          CREATE SCHEMA test_schema;

          CREATE TABLE test_schema.items (
            id serial PRIMARY KEY,
            title text NOT NULL,
            status text DEFAULT 'active'
          );

          CREATE VIEW test_schema.item_details AS
            SELECT i.* FROM test_schema.items i;
        `;

        const testSql = `
          ALTER TABLE test_schema.items ADD COLUMN priority int DEFAULT 0;

          DROP VIEW test_schema.item_details;
          CREATE VIEW test_schema.item_details AS
            SELECT i.* FROM test_schema.items i;
        `;

        await db.main.query(initialSetup);
        await db.branch.query(initialSetup);
        await db.branch.query(testSql);

        const result = await createPlan(db.main, db.branch);
        expect(result).not.toBeNull();
        if (!result) throw new Error("expected plan result");

        const statements = flattenPlanStatements(result.plan);
        const dropViewIndex = statements.findIndex((statement) =>
          statement.startsWith("DROP VIEW test_schema.item_details"),
        );
        const alterTableIndex = statements.findIndex((statement) =>
          statement.startsWith(
            "ALTER TABLE test_schema.items ADD COLUMN priority integer DEFAULT 0",
          ),
        );
        const createViewIndex = statements.findIndex((statement) =>
          statement.startsWith("CREATE VIEW test_schema.item_details AS"),
        );

        expect(dropViewIndex).toBeGreaterThanOrEqual(0);
        expect(alterTableIndex).toBeGreaterThanOrEqual(0);
        expect(createViewIndex).toBeGreaterThanOrEqual(0);
        expect(dropViewIndex).toBeLessThan(alterTableIndex);
        expect(alterTableIndex).toBeLessThan(createViewIndex);
        expect(
          statements.some((statement) =>
            statement.startsWith(
              "CREATE OR REPLACE VIEW test_schema.item_details AS",
            ),
          ),
        ).toBe(false);
      }),
    );

    test(
      "complex view dependencies with multiple joins",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: "CREATE SCHEMA analytics;",
          testSql: `
          CREATE TABLE analytics.customers (
            id integer,
            name text,
            region text,
            tier text
          );

          CREATE TABLE analytics.products (
            id integer,
            name text,
            category text,
            price decimal(10,2)
          );

          CREATE TABLE analytics.sales (
            id integer,
            customer_id integer,
            product_id integer,
            quantity integer,
            sale_date date
          );

          -- Base analytical views
          CREATE VIEW analytics.customer_stats AS
          SELECT
            c.id,
            c.name,
            c.region,
            c.tier,
            COUNT(s.id) as total_orders,
            SUM(s.quantity * p.price) as total_revenue
          FROM analytics.customers c
          LEFT JOIN analytics.sales s ON c.id = s.customer_id
          LEFT JOIN analytics.products p ON s.product_id = p.id
          GROUP BY c.id, c.name, c.region, c.tier;

          CREATE VIEW analytics.product_performance AS
          SELECT
            p.id,
            p.name,
            p.category,
            p.price,
            COUNT(s.id) as units_sold,
            SUM(s.quantity) as total_quantity
          FROM analytics.products p
          LEFT JOIN analytics.sales s ON p.id = s.product_id
          GROUP BY p.id, p.name, p.category, p.price;

          -- Higher-level analytics view depending on both above views
          CREATE VIEW analytics.business_summary AS
          SELECT
            'customers' as metric_type,
            COUNT(*) as count,
            AVG(total_revenue) as avg_value
          FROM analytics.customer_stats
          WHERE total_revenue > 0

          UNION ALL

          SELECT
            'products' as metric_type,
            COUNT(*) as count,
            AVG(price) as avg_value
          FROM analytics.product_performance
          WHERE units_sold > 0;
        `,
        });
      }),
    );

    test(
      "valid recursive patterns are not flagged as cycles",
      withDb(pgVersion, async (db) => {
        // Test case: Valid recursive CTE pattern that should NOT be flagged as a cycle
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: "CREATE SCHEMA test_schema;",
          testSql: `
            CREATE TABLE test_schema.employees (
              id integer,
              name text,
              manager_id integer
            );

            -- This is a valid recursive pattern using CTE, not a cycle
            CREATE VIEW test_schema.employee_hierarchy AS
            WITH RECURSIVE hierarchy AS (
              SELECT id, name, manager_id, 0 as level
              FROM test_schema.employees
              WHERE manager_id IS NULL
              
              UNION ALL
              
              SELECT e.id, e.name, e.manager_id, h.level + 1
              FROM test_schema.employees e
              JOIN hierarchy h ON e.manager_id = h.id
            )
            SELECT * FROM hierarchy;
          `,
        });
      }),
    );

    test(
      "view comments",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.users (
            id integer,
            name text
          );
          CREATE VIEW test_schema.user_names AS SELECT id, name FROM test_schema.users;
        `,
          testSql: `
          COMMENT ON VIEW test_schema.user_names IS 'users names view';
        `,
        });
      }),
    );

    // security_invoker views are PG15+.
    test.skipIf(pgVersion < 15)(
      "view with options",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.users (
            id integer,
            name text
          );
          CREATE VIEW test_schema.alter_options WITH (security_barrier = TRUE) AS SELECT id, name FROM test_schema.users;
          CREATE VIEW test_schema.reset_options WITH (security_invoker = TRUE) AS SELECT id, name FROM test_schema.users;
        `,
          testSql: `
          ALTER VIEW test_schema.alter_options SET (security_invoker = TRUE, security_barrier = FALSE);
          CREATE VIEW test_schema.create_with_options WITH (security_invoker = TRUE) AS SELECT id, name FROM test_schema.users;
          ALTER VIEW test_schema.reset_options RESET (security_invoker);
          `,
        });
      }),
    );

    test(
      "view owner change",
      withDbIsolated(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE ROLE view_previous_owner WITH LOGIN;
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.users (
            id integer,
            name text
          );
          CREATE VIEW test_schema.owned_view AS SELECT id, name FROM test_schema.users;
          ALTER VIEW test_schema.owned_view OWNER TO view_previous_owner;
        `,
          testSql: `
          CREATE ROLE view_new_owner WITH LOGIN;
          ALTER VIEW test_schema.owned_view OWNER TO view_new_owner;
        `,
        });
      }),
    );
  });
}
// CASCADE operations are intentionally not supported as dependency resolution
// handles proper ordering of DROP operations automatically
// NOTE: View cycles can occur in PostgreSQL through recursive CTEs or complex dependency patterns.
// For example:
// - View A references View B in a subquery
// - View B references View A in a different context
// - Both views exist but create a logical circular dependency
//
// PostgreSQL itself prevents direct cycles during view creation, but complex patterns
// involving multiple views, functions, and recursive CTEs can create scenarios where
// dependency resolution becomes challenging.
//
// TODO: Add integration tests for view cycle detection once cycle detection is implemented
// in the dependency resolution system. These tests should verify that:
// 1. Obvious cycles are detected and reported
// 2. Complex multi-level cycles are identified
// 3. False positives (valid recursive patterns) are not flagged as cycles
// 4. Proper error messages guide users on how to resolve cycles
