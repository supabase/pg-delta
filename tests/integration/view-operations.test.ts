/**
 * Integration tests for PostgreSQL view operations.
 */

import { describe } from "vitest";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { getTest } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  const test = getTest(pgVersion);

  describe.concurrent(`view operations (pg${pgVersion})`, () => {
    test("simple view creation", async ({ db }) => {
      await roundtripFidelityTest({
        masterSession: db.main,
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
        description: "simple view creation",
        expectedSqlTerms: [
          `CREATE TABLE test_schema.users (id integer, name text, email text)`,
          `CREATE OR REPLACE VIEW test_schema.active_users AS  SELECT id,
    name,
    email
   FROM test_schema.users
  WHERE (email IS NOT NULL);`,
        ],
        expectedMasterDependencies: [],
        expectedBranchDependencies: [
          {
            dependent_stable_id: "table:test_schema.users",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          }, // Table depends on schema
          {
            dependent_stable_id: "view:test_schema.active_users",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          }, // View depends on schema
          {
            dependent_stable_id: "view:test_schema.active_users",
            referenced_stable_id: "table:test_schema.users",
            deptype: "n",
          }, // View depends on table
        ],
      });
    });

    test("nested view dependencies - 3 levels deep", async ({ db }) => {
      await roundtripFidelityTest({
        masterSession: db.main,
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
        description: "nested view dependencies - 3 levels deep",
        expectedSqlTerms: [
          `CREATE TABLE test_schema.users (id integer, name text, email text, created_at timestamp without time zone DEFAULT now())`,
          `CREATE OR REPLACE VIEW test_schema.recent_users AS  SELECT id,
    name,
    email,
    created_at
   FROM test_schema.users
  WHERE (created_at > (now() - '30 days'::interval));`,
          `CREATE TABLE test_schema.orders (id integer, user_id integer, amount numeric(10,2), created_at timestamp without time zone DEFAULT now())`,
          `CREATE OR REPLACE VIEW test_schema.high_value_orders AS  SELECT id,
    user_id,
    amount,
    created_at
   FROM test_schema.orders
  WHERE (amount > (100)::numeric);`,
          `CREATE OR REPLACE VIEW test_schema.recent_big_spenders AS  SELECT u.id,
    u.name,
    u.email,
    count(o.id) AS order_count,
    sum(o.amount) AS total_spent
   FROM (test_schema.recent_users u
     JOIN test_schema.high_value_orders o ON ((u.id = o.user_id)))
  GROUP BY u.id, u.name, u.email;`,
          `CREATE OR REPLACE VIEW test_schema.top_customers AS  SELECT id,
    name,
    email,
    total_spent
   FROM test_schema.recent_big_spenders
  WHERE (total_spent > (1000)::numeric)
  ORDER BY total_spent DESC
 LIMIT 10;`,
        ],
        expectedMasterDependencies: [],
        expectedBranchDependencies: [
          // Table-schema dependencies
          {
            dependent_stable_id: "table:test_schema.users",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "table:test_schema.orders",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          // View-schema dependencies
          {
            dependent_stable_id: "view:test_schema.recent_users",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "view:test_schema.high_value_orders",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "view:test_schema.recent_big_spenders",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "view:test_schema.top_customers",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          // Level 1 view-table dependencies
          {
            dependent_stable_id: "view:test_schema.recent_users",
            referenced_stable_id: "table:test_schema.users",
            deptype: "n",
          },
          {
            dependent_stable_id: "view:test_schema.high_value_orders",
            referenced_stable_id: "table:test_schema.orders",
            deptype: "n",
          },
          // Level 2 view-view dependencies
          {
            dependent_stable_id: "view:test_schema.recent_big_spenders",
            referenced_stable_id: "view:test_schema.recent_users",
            deptype: "n",
          },
          {
            dependent_stable_id: "view:test_schema.recent_big_spenders",
            referenced_stable_id: "view:test_schema.high_value_orders",
            deptype: "n",
          },
          // Level 3 view-view dependencies
          {
            dependent_stable_id: "view:test_schema.top_customers",
            referenced_stable_id: "view:test_schema.recent_big_spenders",
            deptype: "n",
          },
        ],
      });
    });

    test("view replacement with dependency changes", async ({ db }) => {
      await roundtripFidelityTest({
        masterSession: db.main,
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
        description: "view replacement with dependency changes",
        expectedSqlTerms: [
          // TODO: check with Julien if the DROP + CREATE is expected here
          `DROP VIEW test_schema.user_summary;
CREATE OR REPLACE VIEW test_schema.user_summary AS  SELECT u.id,
    u.name,
    u.status,
    p.bio,
    p.avatar_url
   FROM (test_schema.users u
     LEFT JOIN test_schema.profiles p ON ((u.id = p.user_id)));`,
        ],
        expectedMasterDependencies: [
          {
            dependent_stable_id: "table:test_schema.users",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "table:test_schema.profiles",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "view:test_schema.user_summary",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "view:test_schema.user_summary",
            referenced_stable_id: "table:test_schema.users",
            deptype: "n",
          }, // Master has view depending only on users table
        ],
        expectedBranchDependencies: [
          {
            dependent_stable_id: "table:test_schema.users",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "table:test_schema.profiles",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "view:test_schema.user_summary",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "view:test_schema.user_summary",
            referenced_stable_id: "table:test_schema.users",
            deptype: "n",
          },
          {
            dependent_stable_id: "view:test_schema.user_summary",
            referenced_stable_id: "table:test_schema.profiles",
            deptype: "n",
          }, // Branch has view depending on both tables
        ],
      });
    });

    test("complex view dependencies with multiple joins", async ({ db }) => {
      await roundtripFidelityTest({
        masterSession: db.main,
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
        description: "complex view dependencies with multiple joins",
        expectedSqlTerms: [
          `CREATE TABLE analytics.sales (id integer, customer_id integer, product_id integer, quantity integer, sale_date date)`,
          `CREATE TABLE analytics.products (id integer, name text, category text, price numeric(10,2))`,
          `CREATE OR REPLACE VIEW analytics.product_performance AS  SELECT p.id,
    p.name,
    p.category,
    p.price,
    count(s.id) AS units_sold,
    sum(s.quantity) AS total_quantity
   FROM (analytics.products p
     LEFT JOIN analytics.sales s ON ((p.id = s.product_id)))
  GROUP BY p.id, p.name, p.category, p.price;`,
          `CREATE TABLE analytics.customers (id integer, name text, region text, tier text)`,
          `CREATE OR REPLACE VIEW analytics.customer_stats AS  SELECT c.id,
    c.name,
    c.region,
    c.tier,
    count(s.id) AS total_orders,
    sum(((s.quantity)::numeric * p.price)) AS total_revenue
   FROM ((analytics.customers c
     LEFT JOIN analytics.sales s ON ((c.id = s.customer_id)))
     LEFT JOIN analytics.products p ON ((s.product_id = p.id)))
  GROUP BY c.id, c.name, c.region, c.tier;`,
          `CREATE OR REPLACE VIEW analytics.business_summary AS  SELECT 'customers'::text AS metric_type,
    count(*) AS count,
    avg(customer_stats.total_revenue) AS avg_value
   FROM analytics.customer_stats
  WHERE (customer_stats.total_revenue > (0)::numeric)
UNION ALL
 SELECT 'products'::text AS metric_type,
    count(*) AS count,
    avg(product_performance.price) AS avg_value
   FROM analytics.product_performance
  WHERE (product_performance.units_sold > 0);`,
        ],
        expectedMasterDependencies: [],
        expectedBranchDependencies: [
          // Table dependencies
          {
            dependent_stable_id: "table:analytics.customers",
            referenced_stable_id: "schema:analytics",
            deptype: "n",
          },
          {
            dependent_stable_id: "table:analytics.products",
            referenced_stable_id: "schema:analytics",
            deptype: "n",
          },
          {
            dependent_stable_id: "table:analytics.sales",
            referenced_stable_id: "schema:analytics",
            deptype: "n",
          },
          // View dependencies
          {
            dependent_stable_id: "view:analytics.customer_stats",
            referenced_stable_id: "schema:analytics",
            deptype: "n",
          },
          {
            dependent_stable_id: "view:analytics.product_performance",
            referenced_stable_id: "schema:analytics",
            deptype: "n",
          },
          {
            dependent_stable_id: "view:analytics.business_summary",
            referenced_stable_id: "schema:analytics",
            deptype: "n",
          },
          // View-table dependencies
          {
            dependent_stable_id: "view:analytics.customer_stats",
            referenced_stable_id: "table:analytics.customers",
            deptype: "n",
          },
          {
            dependent_stable_id: "view:analytics.customer_stats",
            referenced_stable_id: "table:analytics.sales",
            deptype: "n",
          },
          {
            dependent_stable_id: "view:analytics.customer_stats",
            referenced_stable_id: "table:analytics.products",
            deptype: "n",
          },
          {
            dependent_stable_id: "view:analytics.product_performance",
            referenced_stable_id: "table:analytics.products",
            deptype: "n",
          },
          {
            dependent_stable_id: "view:analytics.product_performance",
            referenced_stable_id: "table:analytics.sales",
            deptype: "n",
          },
          // View-view dependencies
          {
            dependent_stable_id: "view:analytics.business_summary",
            referenced_stable_id: "view:analytics.customer_stats",
            deptype: "n",
          },
          {
            dependent_stable_id: "view:analytics.business_summary",
            referenced_stable_id: "view:analytics.product_performance",
            deptype: "n",
          },
        ],
      });
    });
  });
}
