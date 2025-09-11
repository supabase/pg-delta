/**
 * Integration tests for mixed database objects (schemas + tables).
 */

import { describe } from "vitest";
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
        description: "schema and table creation",
        expectedSqlTerms: [
          "CREATE SCHEMA test_schema AUTHORIZATION postgres",
          "CREATE TABLE test_schema.users (id integer, name text NOT NULL, email text, created_at timestamp without time zone DEFAULT now())",
        ],
        expectedMainDependencies: [], // Main has no dependencies (empty state)
        expectedBranchDependencies: [
          {
            dependent_stable_id: "table:test_schema.users",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
        ],
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
        description: "multiple schemas and tables",
        expectedSqlTerms: [
          "CREATE SCHEMA core AUTHORIZATION postgres",
          "CREATE TABLE core.users (id integer, username text NOT NULL, email text)",
          "CREATE TABLE core.posts (id integer, title text NOT NULL, content text, user_id integer)",
          "CREATE SCHEMA analytics AUTHORIZATION postgres",
          "CREATE TABLE analytics.user_stats (user_id integer, post_count integer DEFAULT 0, last_login timestamp without time zone)",
        ],
        expectedMainDependencies: [], // Main has no dependencies (empty state)
        expectedBranchDependencies: [
          {
            dependent_stable_id: "table:core.users",
            referenced_stable_id: "schema:core",
            deptype: "n",
          },
          {
            dependent_stable_id: "table:core.posts",
            referenced_stable_id: "schema:core",
            deptype: "n",
          },
          {
            dependent_stable_id: "table:analytics.user_stats",
            referenced_stable_id: "schema:analytics",
            deptype: "n",
          },
        ],
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
        description: "complex column types",
        expectedSqlTerms: [
          "CREATE SCHEMA test_schema AUTHORIZATION postgres",
          "CREATE TABLE test_schema.complex_table (id uuid, metadata jsonb, tags text[], coordinates point, price numeric(10,2), is_active boolean DEFAULT true, created_at timestamp with time zone DEFAULT now())",
        ],
        expectedMainDependencies: [], // Main has no dependencies (empty state)
        expectedBranchDependencies: [
          {
            dependent_stable_id: "table:test_schema.complex_table",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
        ],
      });
    });

    test("empty database", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "",
        testSql: "",
        description: "empty database",
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
        description: "schema only",
        expectedSqlTerms: ["CREATE SCHEMA empty_schema AUTHORIZATION postgres"],
        expectedMainDependencies: [], // Main has no dependencies (empty state)
        expectedBranchDependencies: [], // Branch has no dependencies (just schema)
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
        description:
          "e-commerce with sequences, tables, constraints, and indexes",
        expectedSqlTerms: [
          "CREATE SCHEMA ecommerce AUTHORIZATION postgres",
          "CREATE SEQUENCE ecommerce.orders_id_seq AS integer",
          "CREATE TABLE ecommerce.orders (id integer DEFAULT nextval('ecommerce.orders_id_seq'::regclass) NOT NULL, customer_id integer NOT NULL, order_number character varying(50) NOT NULL, status character varying(20) DEFAULT 'pending'::character varying, total_amount numeric(10,2) NOT NULL, created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP)",
          "ALTER SEQUENCE ecommerce.orders_id_seq OWNED BY ecommerce.orders.id",
          "ALTER TABLE ecommerce.orders ADD CONSTRAINT orders_order_number_key UNIQUE (order_number)",
          "ALTER TABLE ecommerce.orders ADD CONSTRAINT orders_pkey PRIMARY KEY (id)",
          "CREATE SEQUENCE ecommerce.customers_id_seq AS integer",
          "CREATE TABLE ecommerce.customers (id integer DEFAULT nextval('ecommerce.customers_id_seq'::regclass) NOT NULL, email character varying(255) NOT NULL, first_name character varying(100) NOT NULL, last_name character varying(100) NOT NULL, created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP)",
          "ALTER SEQUENCE ecommerce.customers_id_seq OWNED BY ecommerce.customers.id",
          "ALTER TABLE ecommerce.customers ADD CONSTRAINT customers_email_key UNIQUE (email)",
          "ALTER TABLE ecommerce.customers ADD CONSTRAINT customers_pkey PRIMARY KEY (id)",
          "ALTER TABLE ecommerce.orders ADD CONSTRAINT fk_customer FOREIGN KEY (customer_id) REFERENCES ecommerce.customers(id)",
          "CREATE INDEX idx_orders_customer_status ON ecommerce.orders USING btree (customer_id, status)",
          "CREATE INDEX idx_customers_email ON ecommerce.customers USING btree (email)",
        ],
        expectedMainDependencies: [], // Main has no dependencies (empty state)
        expectedBranchDependencies: [
          // Schema dependencies
          {
            dependent_stable_id: "table:ecommerce.customers",
            referenced_stable_id: "schema:ecommerce",
            deptype: "n",
          },
          {
            dependent_stable_id: "table:ecommerce.orders",
            referenced_stable_id: "schema:ecommerce",
            deptype: "n",
          },
          {
            dependent_stable_id: "sequence:ecommerce.customers_id_seq",
            referenced_stable_id: "schema:ecommerce",
            deptype: "n",
          },
          {
            dependent_stable_id: "sequence:ecommerce.orders_id_seq",
            referenced_stable_id: "schema:ecommerce",
            deptype: "n",
          },
          // Sequence ownership dependencies (sequences owned by tables)
          // TODO: find out why dependecies are missing
          {
            dependent_stable_id: "sequence:ecommerce.customers_id_seq",
            referenced_stable_id: "table:ecommerce.customers",
            deptype: "a",
          },
          {
            dependent_stable_id: "sequence:ecommerce.orders_id_seq",
            referenced_stable_id: "table:ecommerce.orders",
            deptype: "a",
          },
          // Constraint dependencies
          {
            dependent_stable_id:
              "constraint:ecommerce.customers.customers_pkey",
            referenced_stable_id: "table:ecommerce.customers",
            deptype: "a",
          },
          {
            dependent_stable_id:
              "constraint:ecommerce.customers.customers_email_key",
            referenced_stable_id: "table:ecommerce.customers",
            deptype: "a",
          },
          {
            dependent_stable_id: "constraint:ecommerce.orders.orders_pkey",
            referenced_stable_id: "table:ecommerce.orders",
            deptype: "a",
          },
          {
            dependent_stable_id:
              "constraint:ecommerce.orders.orders_order_number_key",
            referenced_stable_id: "table:ecommerce.orders",
            deptype: "a",
          },
          {
            dependent_stable_id: "constraint:ecommerce.orders.fk_customer",
            referenced_stable_id: "table:ecommerce.orders",
            deptype: "a",
          },
          {
            dependent_stable_id: "constraint:ecommerce.orders.fk_customer",
            referenced_stable_id: "table:ecommerce.customers",
            deptype: "n",
          },
          {
            dependent_stable_id: "constraint:ecommerce.orders.fk_customer",
            referenced_stable_id: "index:ecommerce.customers_pkey",
            deptype: "n",
          },
          // Index dependencies (indexes depend on their underlying constraints/tables)
          {
            dependent_stable_id: "index:ecommerce.customers_pkey",
            referenced_stable_id:
              "constraint:ecommerce.customers.customers_pkey",
            deptype: "i",
          },
          {
            dependent_stable_id: "index:ecommerce.customers_email_key",
            referenced_stable_id:
              "constraint:ecommerce.customers.customers_email_key",
            deptype: "i",
          },
          {
            dependent_stable_id: "index:ecommerce.orders_pkey",
            referenced_stable_id: "constraint:ecommerce.orders.orders_pkey",
            deptype: "i",
          },
          {
            dependent_stable_id: "index:ecommerce.orders_order_number_key",
            referenced_stable_id:
              "constraint:ecommerce.orders.orders_order_number_key",
            deptype: "i",
          },
          {
            dependent_stable_id: "index:ecommerce.idx_customers_email",
            referenced_stable_id: "table:ecommerce.customers",
            deptype: "a",
          },
          {
            dependent_stable_id: "index:ecommerce.idx_orders_customer_status",
            referenced_stable_id: "table:ecommerce.orders",
            deptype: "a",
          },
        ],
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
        description: "complex dependency ordering",
        expectedSqlTerms: [
          "CREATE TABLE test_schema.users (id integer NOT NULL, name text)",
          "ALTER TABLE test_schema.users ADD CONSTRAINT users_pkey PRIMARY KEY (id)",
          "CREATE TABLE test_schema.orders (id integer NOT NULL, user_id integer, amount numeric)",
          "ALTER TABLE test_schema.orders ADD CONSTRAINT orders_pkey PRIMARY KEY (id)",
          "CREATE VIEW test_schema.user_orders AS SELECT u.id,\n    u.name,\n    sum(o.amount) AS total\n   FROM (test_schema.users u\n     LEFT JOIN test_schema.orders o ON ((u.id = o.user_id)))\n  GROUP BY u.id, u.name",
          "CREATE VIEW test_schema.top_users AS SELECT id,\n    name,\n    total\n   FROM test_schema.user_orders\n  WHERE (total > (1000)::numeric)",
        ],
        expectedMainDependencies: [],
        expectedBranchDependencies: [
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
          {
            dependent_stable_id: "constraint:test_schema.users.users_pkey",
            referenced_stable_id: "table:test_schema.users",
            deptype: "a",
          }, // PK constraint depends on table
          {
            dependent_stable_id: "constraint:test_schema.orders.orders_pkey",
            referenced_stable_id: "table:test_schema.orders",
            deptype: "a",
          }, // PK constraint depends on table
          {
            dependent_stable_id: "index:test_schema.users_pkey",
            referenced_stable_id: "constraint:test_schema.users.users_pkey",
            deptype: "i",
          }, // Index depends on PK constraint
          {
            dependent_stable_id: "index:test_schema.orders_pkey",
            referenced_stable_id: "constraint:test_schema.orders.orders_pkey",
            deptype: "i",
          }, // Index depends on PK constraint
          {
            dependent_stable_id: "view:test_schema.user_orders",
            referenced_stable_id: "table:test_schema.users",
            deptype: "n",
          },
          {
            dependent_stable_id: "view:test_schema.user_orders",
            referenced_stable_id: "table:test_schema.orders",
            deptype: "n",
          },
          {
            dependent_stable_id: "view:test_schema.user_orders",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "view:test_schema.top_users",
            referenced_stable_id: "view:test_schema.user_orders",
            deptype: "n",
          },
          {
            dependent_stable_id: "view:test_schema.top_users",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
        ],
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
        description: "drop operations with complex dependencies",
        expectedSqlTerms: [
          "DROP VIEW test_schema.v3",
          "DROP VIEW test_schema.v2",
          "DROP VIEW test_schema.v1",
          "DROP TABLE test_schema.base",
          "DROP SCHEMA test_schema",
        ],
        expectedMainDependencies: [
          {
            dependent_stable_id: "table:test_schema.base",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "constraint:test_schema.base.base_pkey",
            referenced_stable_id: "table:test_schema.base",
            deptype: "a",
          }, // PK constraint depends on table
          {
            dependent_stable_id: "index:test_schema.base_pkey",
            referenced_stable_id: "constraint:test_schema.base.base_pkey",
            deptype: "i",
          }, // Index depends on PK constraint
          {
            dependent_stable_id: "view:test_schema.v1",
            referenced_stable_id: "table:test_schema.base",
            deptype: "n",
          },
          {
            dependent_stable_id: "view:test_schema.v1",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "view:test_schema.v2",
            referenced_stable_id: "view:test_schema.v1",
            deptype: "n",
          },
          {
            dependent_stable_id: "view:test_schema.v2",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "view:test_schema.v3",
            referenced_stable_id: "view:test_schema.v2",
            deptype: "n",
          },
          {
            dependent_stable_id: "view:test_schema.v3",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
        ],
        expectedBranchDependencies: [], // Branch has no dependencies (everything dropped)
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
        description: "mixed create and replace operations",
        expectedSqlTerms: [
          "ALTER TABLE test_schema.data ADD COLUMN status text",
          "DROP VIEW test_schema.summary;\nCREATE VIEW test_schema.summary AS SELECT count(*) AS cnt,\n    count(\n        CASE\n            WHEN (status = 'active'::text) THEN 1\n            ELSE NULL::integer\n        END) AS active_cnt\n   FROM test_schema.data",
        ],
        expectedMainDependencies: [
          {
            dependent_stable_id: "table:test_schema.data",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "constraint:test_schema.data.data_pkey",
            referenced_stable_id: "table:test_schema.data",
            deptype: "a",
          }, // PK constraint depends on table
          {
            dependent_stable_id: "index:test_schema.data_pkey",
            referenced_stable_id: "constraint:test_schema.data.data_pkey",
            deptype: "i",
          }, // Index depends on PK constraint
          {
            dependent_stable_id: "view:test_schema.summary",
            referenced_stable_id: "table:test_schema.data",
            deptype: "n",
          },
          {
            dependent_stable_id: "view:test_schema.summary",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
        ],
        expectedBranchDependencies: [
          {
            dependent_stable_id: "table:test_schema.data",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "constraint:test_schema.data.data_pkey",
            referenced_stable_id: "table:test_schema.data",
            deptype: "a",
          }, // PK constraint depends on table
          {
            dependent_stable_id: "index:test_schema.data_pkey",
            referenced_stable_id: "constraint:test_schema.data.data_pkey",
            deptype: "i",
          }, // Index depends on PK constraint
          {
            dependent_stable_id: "view:test_schema.summary",
            referenced_stable_id: "table:test_schema.data",
            deptype: "n",
          },
          {
            dependent_stable_id: "view:test_schema.summary",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
        ],
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
        description: "cross-schema view dependencies",
        expectedSqlTerms: [], // No SQL expected since no changes
        expectedMainDependencies: [
          {
            dependent_stable_id: "table:schema_a.table_a",
            referenced_stable_id: "schema:schema_a",
            deptype: "n",
          },
          {
            dependent_stable_id: "table:schema_b.table_b",
            referenced_stable_id: "schema:schema_b",
            deptype: "n",
          },
          {
            dependent_stable_id: "constraint:schema_a.table_a.table_a_pkey",
            referenced_stable_id: "table:schema_a.table_a",
            deptype: "a",
          }, // PK constraint depends on table
          {
            dependent_stable_id: "constraint:schema_b.table_b.table_b_pkey",
            referenced_stable_id: "table:schema_b.table_b",
            deptype: "a",
          }, // PK constraint depends on table
          {
            dependent_stable_id: "index:schema_a.table_a_pkey",
            referenced_stable_id: "constraint:schema_a.table_a.table_a_pkey",
            deptype: "i",
          }, // Index depends on PK constraint
          {
            dependent_stable_id: "index:schema_b.table_b_pkey",
            referenced_stable_id: "constraint:schema_b.table_b.table_b_pkey",
            deptype: "i",
          }, // Index depends on PK constraint
          {
            dependent_stable_id: "view:schema_a.cross_view",
            referenced_stable_id: "table:schema_a.table_a",
            deptype: "n",
          },
          {
            dependent_stable_id: "view:schema_a.cross_view",
            referenced_stable_id: "table:schema_b.table_b",
            deptype: "n",
          },
          {
            dependent_stable_id: "view:schema_a.cross_view",
            referenced_stable_id: "schema:schema_a",
            deptype: "n",
          },
        ],
        expectedBranchDependencies: [
          {
            dependent_stable_id: "table:schema_a.table_a",
            referenced_stable_id: "schema:schema_a",
            deptype: "n",
          },
          {
            dependent_stable_id: "table:schema_b.table_b",
            referenced_stable_id: "schema:schema_b",
            deptype: "n",
          },
          {
            dependent_stable_id: "constraint:schema_a.table_a.table_a_pkey",
            referenced_stable_id: "table:schema_a.table_a",
            deptype: "a",
          }, // PK constraint depends on table
          {
            dependent_stable_id: "constraint:schema_b.table_b.table_b_pkey",
            referenced_stable_id: "table:schema_b.table_b",
            deptype: "a",
          }, // PK constraint depends on table
          {
            dependent_stable_id: "index:schema_a.table_a_pkey",
            referenced_stable_id: "constraint:schema_a.table_a.table_a_pkey",
            deptype: "i",
          }, // Index depends on PK constraint
          {
            dependent_stable_id: "index:schema_b.table_b_pkey",
            referenced_stable_id: "constraint:schema_b.table_b.table_b_pkey",
            deptype: "i",
          }, // Index depends on PK constraint
          {
            dependent_stable_id: "view:schema_a.cross_view",
            referenced_stable_id: "table:schema_a.table_a",
            deptype: "n",
          },
          {
            dependent_stable_id: "view:schema_a.cross_view",
            referenced_stable_id: "table:schema_b.table_b",
            deptype: "n",
          },
          {
            dependent_stable_id: "view:schema_a.cross_view",
            referenced_stable_id: "schema:schema_a",
            deptype: "n",
          },
        ],
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
        description: "basic table schema dependency validation",
        expectedSqlTerms: [
          "CREATE SCHEMA analytics AUTHORIZATION postgres",
          "CREATE TABLE analytics.users (id integer, name text)",
        ],
        expectedMainDependencies: [], // Main has no dependencies (empty state)
        expectedBranchDependencies: [
          {
            dependent_stable_id: "table:analytics.users",
            referenced_stable_id: "schema:analytics",
            deptype: "n",
          },
        ],
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
        description: "multiple independent schema table pairs",
        expectedSqlTerms: [
          "CREATE SCHEMA app AUTHORIZATION postgres",
          "CREATE TABLE app.users (id integer)",
          "CREATE SCHEMA analytics AUTHORIZATION postgres",
          "CREATE TABLE analytics.reports (id integer)",
        ],
        expectedMainDependencies: [], // Main has no dependencies (empty state)
        expectedBranchDependencies: [
          {
            dependent_stable_id: "table:app.users",
            referenced_stable_id: "schema:app",
            deptype: "n",
          },
          {
            dependent_stable_id: "table:analytics.reports",
            referenced_stable_id: "schema:analytics",
            deptype: "n",
          },
        ],
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
        description: "drop schema only",
        expectedSqlTerms: ["DROP SCHEMA temp_schema"],
        expectedMainDependencies: [], // Main dependencies (temp_schema exists)
        expectedBranchDependencies: [], // Branch has no dependencies (schema dropped)
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
        description: "multiple drops with dependency ordering",
        expectedSqlTerms: [
          "DROP TABLE app.users",
          "DROP TABLE analytics.reports",
          "DROP SCHEMA app",
          "DROP SCHEMA analytics",
        ],
        expectedMainDependencies: [
          {
            dependent_stable_id: "table:app.users",
            referenced_stable_id: "schema:app",
            deptype: "n",
          },
          {
            dependent_stable_id: "table:analytics.reports",
            referenced_stable_id: "schema:analytics",
            deptype: "n",
          },
        ], // Main dependencies (objects exist before drop)
        expectedBranchDependencies: [], // Branch has no dependencies (everything dropped)
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
        description: "complex multi-schema drop scenario",
        expectedSqlTerms: [
          "DROP TABLE reporting.summary",
          "DROP TABLE core.users",
          "DROP TABLE analytics.events",
          "DROP SCHEMA reporting",
          "DROP SCHEMA core",
          "DROP SCHEMA analytics",
        ],
        expectedMainDependencies: [
          {
            dependent_stable_id: "table:core.users",
            referenced_stable_id: "schema:core",
            deptype: "n",
          },
          {
            dependent_stable_id: "table:analytics.events",
            referenced_stable_id: "schema:analytics",
            deptype: "n",
          },
          {
            dependent_stable_id: "table:reporting.summary",
            referenced_stable_id: "schema:reporting",
            deptype: "n",
          },
        ], // Main dependencies (objects exist before drop)
        expectedBranchDependencies: [], // Branch has no dependencies (everything dropped)
      });
    });
  });
}
