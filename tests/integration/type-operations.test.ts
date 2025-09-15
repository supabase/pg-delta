/**
 * Integration tests for PostgreSQL type operations.
 */

import dedent from "dedent";
import { describe } from "vitest";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { getTest } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  const test = getTest(pgVersion);

  describe.concurrent(`type operations (pg${pgVersion})`, () => {
    test("create enum type", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "CREATE SCHEMA test_schema;",
        testSql: `
          CREATE TYPE test_schema.mood AS ENUM ('sad', 'ok', 'happy');
        `,
        description: "create enum type",
        expectedSqlTerms: [
          `CREATE TYPE test_schema.mood AS ENUM ('sad', 'ok', 'happy')`,
        ],
      });
    });
    test("create domain type with constraint", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "CREATE SCHEMA test_schema;",
        testSql: `
          CREATE DOMAIN test_schema.positive_int AS INTEGER CHECK (VALUE > 0);
        `,
        description: "create domain type with constraint",
        expectedSqlTerms: [
          `CREATE DOMAIN test_schema.positive_int AS integer CHECK ((VALUE > 0))`,
        ],
      });
    });
    test("create composite type", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "CREATE SCHEMA test_schema;",
        testSql: `
          CREATE TYPE test_schema.address AS (
            street VARCHAR(90),
            city VARCHAR(90),
            state VARCHAR(2)
          );
        `,
        description: "create composite type",
        expectedSqlTerms: [
          `CREATE TYPE test_schema.address AS (street character varying(90), city character varying(90), state character varying(2))`,
        ],
      });
    });
    test("create range type", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "CREATE SCHEMA test_schema;",
        testSql: `
          CREATE TYPE test_schema.floatrange AS RANGE (subtype = float8);
        `,
        description: "create range type",
        expectedSqlTerms: [
          `CREATE TYPE test_schema.floatrange AS RANGE (SUBTYPE = double precision)`,
        ],
      });
    });
    test("drop enum type", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup:
          "CREATE SCHEMA test_schema; CREATE TYPE test_schema.old_mood AS ENUM ('sad', 'happy');",
        testSql: `
          DROP TYPE test_schema.old_mood;
        `,
        description: "drop enum type",
        expectedSqlTerms: [`DROP TYPE test_schema.old_mood`],
      });
    });
    test("replace enum type (modify values)", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup:
          "CREATE SCHEMA test_schema; CREATE TYPE test_schema.status AS ENUM ('pending', 'approved');",
        testSql: `
          DROP TYPE test_schema.status;
          CREATE TYPE test_schema.status AS ENUM ('pending', 'approved', 'rejected');
        `,
        description: "replace enum type (modify values)",
        expectedSqlTerms: [
          `ALTER TYPE test_schema.status ADD VALUE 'rejected' AFTER 'approved'`,
        ],
      });
    });
    test("replace domain type (modify constraint)", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup:
          "CREATE SCHEMA test_schema; CREATE DOMAIN test_schema.valid_int AS INTEGER CHECK (VALUE > 0);",
        testSql: `
          DROP DOMAIN test_schema.valid_int;
          CREATE DOMAIN test_schema.valid_int AS INTEGER CHECK (VALUE >= 0 AND VALUE <= 100);
        `,
        description: "replace domain type (modify constraint)",
        expectedSqlTerms: [
          `ALTER DOMAIN test_schema.valid_int DROP CONSTRAINT valid_int_check`,
          `ALTER DOMAIN test_schema.valid_int ADD CONSTRAINT valid_int_check CHECK (((VALUE >= 0) AND (VALUE <= 100)))`,
        ],
      });
    });

    test("enum type with table dependency", async ({ db }) => {
      await roundtripFidelityTest({
        name: "enum-table-dependency",
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "CREATE SCHEMA test_schema;",
        testSql: `
      CREATE TYPE test_schema.user_status AS ENUM ('active', 'inactive', 'pending');

      CREATE TABLE test_schema.users (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        status test_schema.user_status DEFAULT 'pending'
      );
    `,
        description: "enum type with table dependency",
        expectedSqlTerms: [
          `CREATE TYPE test_schema.user_status AS ENUM ('active', 'inactive', 'pending')`,
          `CREATE TABLE test_schema.users (id integer NOT NULL, name text NOT NULL, status test_schema.user_status DEFAULT 'pending'::test_schema.user_status)`,
          `ALTER TABLE test_schema.users ADD CONSTRAINT users_pkey PRIMARY KEY (id)`,
        ],
        expectedMainDependencies: [],
        expectedBranchDependencies: [
          {
            dependent_stable_id: "enum:test_schema.user_status",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          }, // Enum type depend on schema
          {
            dependent_stable_id: "table:test_schema.users",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          }, // Table depends on schema
          {
            dependent_stable_id: "table:test_schema.users",
            referenced_stable_id: "enum:test_schema.user_status",
            deptype: "n",
          }, // Table depends on enum type
          {
            dependent_stable_id: "index:test_schema.users_pkey",
            referenced_stable_id: "constraint:test_schema.users.users_pkey",
            deptype: "i",
          }, // Index depends on constraint
          {
            dependent_stable_id: "constraint:test_schema.users.users_pkey",
            referenced_stable_id: "table:test_schema.users",
            deptype: "a",
          }, // Constraint depends on table
        ],
      });
    });

    test("domain type with table dependency", async ({ db }) => {
      await roundtripFidelityTest({
        name: "domain-table-dependency",
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "CREATE SCHEMA test_schema;",
        testSql: `
        CREATE DOMAIN test_schema.email AS TEXT CHECK (VALUE ~ '^[^@]+@[^@]+\\.[^@]+$');

        CREATE TABLE test_schema.users (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          email_address test_schema.email
        );
      `,
        description: "domain type with table dependency",
        expectedSqlTerms: [
          `CREATE DOMAIN test_schema.email AS text CHECK ((VALUE ~ '^[^@]+@[^@]+\\.[^@]+$'::text))`,
          "CREATE TABLE test_schema.users (id integer NOT NULL, name text NOT NULL, email_address test_schema.email)",
          "ALTER TABLE test_schema.users ADD CONSTRAINT users_pkey PRIMARY KEY (id)",
        ],
        expectedMainDependencies: [],
        expectedBranchDependencies: [
          {
            dependent_stable_id: "domain:test_schema.email",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          }, // Domain type depends on schema
          {
            dependent_stable_id: "table:test_schema.users",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          }, // Table depends on schema
          {
            dependent_stable_id: "table:test_schema.users",
            referenced_stable_id: "domain:test_schema.email",
            deptype: "n",
          }, // Table depends on domain type
          {
            dependent_stable_id: "index:test_schema.users_pkey",
            referenced_stable_id: "constraint:test_schema.users.users_pkey",
            deptype: "i",
          }, // Index depends on constraint
          {
            dependent_stable_id: "constraint:test_schema.users.users_pkey",
            referenced_stable_id: "table:test_schema.users",
            deptype: "a",
          }, // Constraint depends on table
        ],
      });
    });

    test("composite type with table dependency", async ({ db }) => {
      await roundtripFidelityTest({
        name: "composite-table-dependency",
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "CREATE SCHEMA test_schema;",
        testSql: `
        CREATE TYPE test_schema.address AS (
          street TEXT,
          city TEXT,
          zip_code TEXT
        );

        CREATE TABLE test_schema.customers (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          billing_address test_schema.address,
          shipping_address test_schema.address
        );
      `,
        description: "composite type with table dependency",
        expectedSqlTerms: [
          `CREATE TYPE test_schema.address AS (street text, city text, zip_code text)`,
          "CREATE TABLE test_schema.customers (id integer NOT NULL, name text NOT NULL, billing_address test_schema.address, shipping_address test_schema.address)",
          "ALTER TABLE test_schema.customers ADD CONSTRAINT customers_pkey PRIMARY KEY (id)",
        ],
        expectedMainDependencies: [],
        expectedBranchDependencies: [
          {
            dependent_stable_id: "compositeType:test_schema.address",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          }, // Composite type depends on schema
          {
            dependent_stable_id: "table:test_schema.customers",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          }, // Table depends on schema
          {
            dependent_stable_id: "table:test_schema.customers",
            referenced_stable_id: "compositeType:test_schema.address",
            deptype: "n",
          }, // Table depends on composite type
          {
            dependent_stable_id: "index:test_schema.customers_pkey",
            referenced_stable_id:
              "constraint:test_schema.customers.customers_pkey",
            deptype: "i",
          }, // Index depends on constraint
          {
            dependent_stable_id:
              "constraint:test_schema.customers.customers_pkey",
            referenced_stable_id: "table:test_schema.customers",
            deptype: "a",
          }, // Constraint depends on table
        ],
      });
    });

    test("multiple types complex dependencies", async ({ db }) => {
      await roundtripFidelityTest({
        name: "multiple-types-complex-dependencies",
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "CREATE SCHEMA commerce;",
        testSql: `
        -- Create base types
        CREATE TYPE commerce.order_status AS ENUM ('pending', 'processing', 'shipped', 'delivered', 'cancelled');
        CREATE DOMAIN commerce.price AS DECIMAL(10,2) CHECK (VALUE >= 0);

        -- Create composite type using domain
        CREATE TYPE commerce.product_info AS (
          name TEXT,
          description TEXT,
          unit_price commerce.price
        );

        -- Create tables using all types
        CREATE TABLE commerce.products (
          id INTEGER PRIMARY KEY,
          info commerce.product_info,
          category TEXT
        );

        CREATE TABLE commerce.orders (
          id INTEGER PRIMARY KEY,
          status commerce.order_status DEFAULT 'pending',
          total_amount commerce.price
        );
      `,
        description: "multiple types with complex dependencies",
        expectedSqlTerms: [
          "CREATE TYPE commerce.order_status AS ENUM ('pending', 'processing', 'shipped', 'delivered', 'cancelled')",
          "CREATE DOMAIN commerce.price AS numeric(10,2) CHECK ((VALUE >= (0)::numeric))",
          "CREATE TABLE commerce.orders (id integer NOT NULL, status commerce.order_status DEFAULT 'pending'::commerce.order_status, total_amount commerce.price)",
          "ALTER TABLE commerce.orders ADD CONSTRAINT orders_pkey PRIMARY KEY (id)",
          "CREATE TYPE commerce.product_info AS (name text, description text, unit_price commerce.price)",
          "CREATE TABLE commerce.products (id integer NOT NULL, info commerce.product_info, category text)",
          "ALTER TABLE commerce.products ADD CONSTRAINT products_pkey PRIMARY KEY (id)",
        ],
        expectedMainDependencies: [],
        expectedBranchDependencies: [
          {
            dependent_stable_id: "enum:commerce.order_status",
            referenced_stable_id: "schema:commerce",
            deptype: "n",
          }, // Enum type depends on schema
          {
            dependent_stable_id: "domain:commerce.price",
            referenced_stable_id: "schema:commerce",
            deptype: "n",
          }, // Domain type depends on schema
          {
            dependent_stable_id: "compositeType:commerce.product_info",
            referenced_stable_id: "schema:commerce",
            deptype: "n",
          }, // Composite type depends on schema
          {
            dependent_stable_id: "compositeType:commerce.product_info",
            referenced_stable_id: "domain:commerce.price",
            deptype: "n",
          }, // Composite type depends on price
          {
            dependent_stable_id: "table:commerce.products",
            referenced_stable_id: "schema:commerce",
            deptype: "n",
          }, // Table depends on schema
          {
            dependent_stable_id: "table:commerce.products",
            referenced_stable_id: "compositeType:commerce.product_info",
            deptype: "n",
          }, // Table depends on composite type
          {
            dependent_stable_id: "table:commerce.orders",
            referenced_stable_id: "schema:commerce",
            deptype: "n",
          }, // Table depends on schema
          {
            dependent_stable_id: "table:commerce.orders",
            referenced_stable_id: "enum:commerce.order_status",
            deptype: "n",
          }, // Table depends on enum
          {
            dependent_stable_id: "table:commerce.orders",
            referenced_stable_id: "domain:commerce.price",
            deptype: "n",
          }, // Table depends on domain
          {
            dependent_stable_id: "constraint:commerce.orders.orders_pkey",
            referenced_stable_id: "table:commerce.orders",
            deptype: "a",
          }, // Constraint depends on table
          {
            dependent_stable_id: "constraint:commerce.products.products_pkey",
            referenced_stable_id: "table:commerce.products",
            deptype: "a",
          }, // Constraint depends on table
          {
            dependent_stable_id: "index:commerce.orders_pkey",
            referenced_stable_id: "constraint:commerce.orders.orders_pkey",
            deptype: "i",
          }, // Index depends on constraint
          {
            dependent_stable_id: "index:commerce.products_pkey",
            referenced_stable_id: "constraint:commerce.products.products_pkey",
            deptype: "i",
          }, // Index depends on constraint
        ],
      });
    });

    test("type cascade drop with dependent table", async ({ db }) => {
      await roundtripFidelityTest({
        name: "type-cascade-drop-dependent-table",
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
        CREATE SCHEMA test_schema;
        CREATE TYPE test_schema.priority AS ENUM ('low', 'medium', 'high');
        CREATE TABLE test_schema.tasks (
          id INTEGER PRIMARY KEY,
          title TEXT,
          priority test_schema.priority DEFAULT 'medium'
        );
      `,
        testSql: `
        DROP TABLE test_schema.tasks;
        DROP TYPE test_schema.priority;
      `,
        description: "type cascade drop with dependent table",
        // TODO: fix the duplicate where INDEX is dropped AND TABLE is dropped as well
        expectedSqlTerms: [
          "DROP TABLE test_schema.tasks",
          "DROP TYPE test_schema.priority",
        ],
        expectedMainDependencies: [
          {
            dependent_stable_id: "enum:test_schema.priority",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          }, // Enum type depends on schema
          {
            dependent_stable_id: "table:test_schema.tasks",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          }, // Table depends on schema
          {
            dependent_stable_id: "table:test_schema.tasks",
            referenced_stable_id: "enum:test_schema.priority",
            deptype: "n",
          }, // Table depends on enum type
          {
            dependent_stable_id: "index:test_schema.tasks_pkey",
            referenced_stable_id: "constraint:test_schema.tasks.tasks_pkey",
            deptype: "i",
          }, // Index depends on constraint
          {
            dependent_stable_id: "constraint:test_schema.tasks.tasks_pkey",
            referenced_stable_id: "table:test_schema.tasks",
            deptype: "a",
          }, // Constraint depends on table
        ],
        expectedBranchDependencies: [],
      });
    });

    test("type name with special characters", async ({ db }) => {
      await roundtripFidelityTest({
        name: "type-name-special-characters",
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: 'CREATE SCHEMA "test-schema";',
        testSql: `
        CREATE TYPE "test-schema"."user-status" AS ENUM ('active', 'in-active');
        CREATE DOMAIN "test-schema"."positive-number" AS INTEGER CHECK (VALUE > 0);
      `,
        description: "type names with special characters",
        expectedSqlTerms: [
          `CREATE TYPE "test-schema"."user-status" AS ENUM ('active', 'in-active')`,
          `CREATE DOMAIN "test-schema"."positive-number" AS integer CHECK ((VALUE > 0))`,
        ],
        expectedMainDependencies: [],
        expectedBranchDependencies: [
          {
            dependent_stable_id: 'enum:"test-schema"."user-status"',
            referenced_stable_id: 'schema:"test-schema"',
            deptype: "n",
          }, // Enum type depends on schema
          {
            dependent_stable_id: 'domain:"test-schema"."positive-number"',
            referenced_stable_id: 'schema:"test-schema"',
            deptype: "n",
          }, // Domain type depends on schema
        ],
      });
    });

    test("materialized view with enum dependency", async ({ db }) => {
      await roundtripFidelityTest({
        name: "materialized-view-enum-dependency",
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "CREATE SCHEMA analytics;",
        testSql: dedent`
        CREATE TYPE analytics.status AS ENUM ('active', 'inactive', 'pending');

        CREATE TABLE analytics.users (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          status analytics.status DEFAULT 'pending'
        );

        CREATE MATERIALIZED VIEW analytics.user_status_summary AS
        SELECT
          status,
          COUNT(*) as count
        FROM analytics.users
        GROUP BY status;
      `,
        description: "materialized view with enum dependency",
        expectedSqlTerms: [
          "CREATE TYPE analytics.status AS ENUM ('active', 'inactive', 'pending')",
          "CREATE TABLE analytics.users (id integer NOT NULL, name text NOT NULL, status analytics.status DEFAULT 'pending'::analytics.status)",
          "ALTER TABLE analytics.users ADD CONSTRAINT users_pkey PRIMARY KEY (id)",
          pgVersion === 15
            ? dedent`
          CREATE MATERIALIZED VIEW analytics.user_status_summary AS SELECT users.status,
              count(*) AS count
             FROM analytics.users
            GROUP BY users.status WITH DATA`
            : dedent`
          CREATE MATERIALIZED VIEW analytics.user_status_summary AS SELECT status,
              count(*) AS count
             FROM analytics.users
            GROUP BY status WITH DATA`,
        ],
        expectedMainDependencies: [],
        expectedBranchDependencies: [
          {
            dependent_stable_id: "enum:analytics.status",
            referenced_stable_id: "schema:analytics",
            deptype: "n",
          }, // Enum type depends on schema
          {
            dependent_stable_id: "table:analytics.users",
            referenced_stable_id: "schema:analytics",
            deptype: "n",
          }, // Table depends on schema
          {
            dependent_stable_id: "table:analytics.users",
            referenced_stable_id: "enum:analytics.status",
            deptype: "n",
          }, // Table depends on enum
          {
            dependent_stable_id: "index:analytics.users_pkey",
            referenced_stable_id: "constraint:analytics.users.users_pkey",
            deptype: "i",
          }, // Index depends on constraint
          {
            dependent_stable_id: "constraint:analytics.users.users_pkey",
            referenced_stable_id: "table:analytics.users",
            deptype: "a",
          }, // Constraint depends on table
          {
            dependent_stable_id:
              "materializedView:analytics.user_status_summary",
            referenced_stable_id: "schema:analytics",
            deptype: "n",
          }, // Materialized view depends on schema
          {
            dependent_stable_id:
              "materializedView:analytics.user_status_summary",
            referenced_stable_id: "table:analytics.users",
            deptype: "n",
          }, // Materialized view depends on table
          {
            dependent_stable_id:
              "materializedView:analytics.user_status_summary",
            referenced_stable_id: "enum:analytics.status",
            deptype: "n",
          }, // Materialized view depends on enum type
        ],
      });
    });

    test("materialized view with domain dependency", async ({ db }) => {
      await roundtripFidelityTest({
        name: "materialized-view-domain-dependency",
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "CREATE SCHEMA financial;",
        testSql: dedent`
        CREATE DOMAIN financial.currency AS DECIMAL(10,2) CHECK (VALUE >= 0);

        CREATE TABLE financial.transactions (
          id INTEGER PRIMARY KEY,
          amount financial.currency NOT NULL,
          description TEXT
        );

        CREATE MATERIALIZED VIEW financial.transaction_summary AS
        SELECT
          SUM(amount) as total_amount,
          COUNT(*) as transaction_count
        FROM financial.transactions
        WHERE amount > 0;
      `,
        description: "materialized view with domain dependency",
        expectedSqlTerms: [
          "CREATE DOMAIN financial.currency AS numeric(10,2) CHECK ((VALUE >= (0)::numeric))",
          "CREATE TABLE financial.transactions (id integer NOT NULL, amount financial.currency NOT NULL, description text)",
          "ALTER TABLE financial.transactions ADD CONSTRAINT transactions_pkey PRIMARY KEY (id)",
          pgVersion === 15
            ? dedent`
          CREATE MATERIALIZED VIEW financial.transaction_summary AS SELECT sum((transactions.amount)::numeric) AS total_amount,
              count(*) AS transaction_count
             FROM financial.transactions
            WHERE ((transactions.amount)::numeric > (0)::numeric) WITH DATA`
            : dedent`
            CREATE MATERIALIZED VIEW financial.transaction_summary AS SELECT sum((amount)::numeric) AS total_amount,
                count(*) AS transaction_count
               FROM financial.transactions
              WHERE ((amount)::numeric > (0)::numeric) WITH DATA`,
        ],
        expectedMainDependencies: [],
        expectedBranchDependencies: [
          {
            dependent_stable_id: "domain:financial.currency",
            referenced_stable_id: "schema:financial",
            deptype: "n",
          }, // Domain type depends on schema
          {
            dependent_stable_id: "table:financial.transactions",
            referenced_stable_id: "schema:financial",
            deptype: "n",
          }, // Table depends on schema
          {
            dependent_stable_id: "table:financial.transactions",
            referenced_stable_id: "domain:financial.currency",
            deptype: "n",
          }, // Table depends on domain
          {
            dependent_stable_id: "index:financial.transactions_pkey",
            referenced_stable_id:
              "constraint:financial.transactions.transactions_pkey",
            deptype: "i",
          }, // Index depends on constraint
          {
            dependent_stable_id:
              "constraint:financial.transactions.transactions_pkey",
            referenced_stable_id: "table:financial.transactions",
            deptype: "a",
          }, // Constraint depends on table
          {
            dependent_stable_id:
              "materializedView:financial.transaction_summary",
            referenced_stable_id: "schema:financial",
            deptype: "n",
          }, // Materialized view depends on schema
          {
            dependent_stable_id:
              "materializedView:financial.transaction_summary",
            referenced_stable_id: "table:financial.transactions",
            deptype: "n",
          }, // Materialized view depends on table
        ],
      });
    });

    test("materialized view with composite type dependency", async ({ db }) => {
      await roundtripFidelityTest({
        name: "materialized-view-composite-dependency",
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "CREATE SCHEMA inventory;",
        testSql: dedent`
        CREATE TYPE inventory.address AS (
          street TEXT,
          city TEXT,
          zip_code TEXT
        );

        CREATE TABLE inventory.warehouses (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          location inventory.address
        );

        CREATE MATERIALIZED VIEW inventory.warehouse_locations AS
        SELECT
          name,
          (location).city as city,
          (location).zip_code as zip_code
        FROM inventory.warehouses
        WHERE (location).city IS NOT NULL;
      `,
        description: "materialized view with composite type dependency",
        expectedSqlTerms: [
          "CREATE TYPE inventory.address AS (street text, city text, zip_code text)",
          "CREATE TABLE inventory.warehouses (id integer NOT NULL, name text NOT NULL, location inventory.address)",
          "ALTER TABLE inventory.warehouses ADD CONSTRAINT warehouses_pkey PRIMARY KEY (id)",
          pgVersion === 15
            ? dedent`
          CREATE MATERIALIZED VIEW inventory.warehouse_locations AS SELECT warehouses.name,
              (warehouses.location).city AS city,
              (warehouses.location).zip_code AS zip_code
             FROM inventory.warehouses
            WHERE ((warehouses.location).city IS NOT NULL) WITH DATA`
            : dedent`
          CREATE MATERIALIZED VIEW inventory.warehouse_locations AS SELECT name,
              (location).city AS city,
              (location).zip_code AS zip_code
             FROM inventory.warehouses
            WHERE ((location).city IS NOT NULL) WITH DATA`,
        ],
        expectedMainDependencies: [],
        expectedBranchDependencies: [
          {
            dependent_stable_id: "compositeType:inventory.address",
            referenced_stable_id: "schema:inventory",
            deptype: "n",
          }, // Composite type depends on schema
          {
            dependent_stable_id: "table:inventory.warehouses",
            referenced_stable_id: "schema:inventory",
            deptype: "n",
          }, // Table depends on schema
          {
            dependent_stable_id: "table:inventory.warehouses",
            referenced_stable_id: "compositeType:inventory.address",
            deptype: "n",
          }, // Table depends on composite type
          {
            dependent_stable_id: "index:inventory.warehouses_pkey",
            referenced_stable_id:
              "constraint:inventory.warehouses.warehouses_pkey",
            deptype: "i",
          }, // Index depends on constraint
          {
            dependent_stable_id:
              "constraint:inventory.warehouses.warehouses_pkey",
            referenced_stable_id: "table:inventory.warehouses",
            deptype: "a",
          }, // Constraint depends on table
          {
            dependent_stable_id:
              "materializedView:inventory.warehouse_locations",
            referenced_stable_id: "schema:inventory",
            deptype: "n",
          }, // Materialized view depends on schema
          {
            dependent_stable_id:
              "materializedView:inventory.warehouse_locations",
            referenced_stable_id: "table:inventory.warehouses",
            deptype: "n",
          }, // Materialized view depends on table
        ],
      });
    });

    test("complex mixed dependencies with materialized views", async ({
      db,
    }) => {
      await roundtripFidelityTest({
        name: "complex-mixed-dependencies-materialized-views",
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "CREATE SCHEMA ecommerce;",
        testSql: dedent`
        -- Create types
        CREATE TYPE ecommerce.order_status AS ENUM ('pending', 'processing', 'shipped', 'delivered');
        CREATE DOMAIN ecommerce.price AS DECIMAL(10,2) CHECK (VALUE >= 0);
        CREATE TYPE ecommerce.product_info AS (
          name TEXT,
          description TEXT,
          base_price ecommerce.price
        );

        -- Create tables using the types
        CREATE TABLE ecommerce.products (
          id INTEGER PRIMARY KEY,
          info ecommerce.product_info NOT NULL,
          category TEXT
        );

        CREATE TABLE ecommerce.orders (
          id INTEGER PRIMARY KEY,
          status ecommerce.order_status DEFAULT 'pending',
          final_price ecommerce.price NOT NULL
        );

        -- Create materialized views that depend on the tables and types
        CREATE MATERIALIZED VIEW ecommerce.product_pricing AS
        SELECT
          id,
          (info).name as product_name,
          (info).base_price as base_price,
          category
        FROM ecommerce.products
        WHERE (info).base_price > 0;

        CREATE MATERIALIZED VIEW ecommerce.order_summary AS
        SELECT
          status,
          COUNT(*) as order_count,
          AVG(final_price) as avg_price
        FROM ecommerce.orders
        GROUP BY status;
      `,
        description: "complex mixed dependencies with materialized views",
        expectedSqlTerms: [
          "CREATE TYPE ecommerce.order_status AS ENUM ('pending', 'processing', 'shipped', 'delivered')",
          "CREATE DOMAIN ecommerce.price AS numeric(10,2) CHECK ((VALUE >= (0)::numeric))",
          "CREATE TABLE ecommerce.orders (id integer NOT NULL, status ecommerce.order_status DEFAULT 'pending'::ecommerce.order_status, final_price ecommerce.price NOT NULL)",
          "ALTER TABLE ecommerce.orders ADD CONSTRAINT orders_pkey PRIMARY KEY (id)",
          pgVersion === 15
            ? dedent`
              CREATE MATERIALIZED VIEW ecommerce.order_summary AS SELECT orders.status,
                  count(*) AS order_count,
                  avg((orders.final_price)::numeric) AS avg_price
                 FROM ecommerce.orders
                GROUP BY orders.status WITH DATA`
            : dedent`
              CREATE MATERIALIZED VIEW ecommerce.order_summary AS SELECT status,
                  count(*) AS order_count,
                  avg((final_price)::numeric) AS avg_price
                 FROM ecommerce.orders
                GROUP BY status WITH DATA`,
          "CREATE TYPE ecommerce.product_info AS (name text, description text, base_price ecommerce.price)",
          "CREATE TABLE ecommerce.products (id integer NOT NULL, info ecommerce.product_info NOT NULL, category text)",
          "ALTER TABLE ecommerce.products ADD CONSTRAINT products_pkey PRIMARY KEY (id)",
          pgVersion === 15
            ? dedent`
              CREATE MATERIALIZED VIEW ecommerce.product_pricing AS SELECT products.id,
                  (products.info).name AS product_name,
                  (products.info).base_price AS base_price,
                  products.category
                 FROM ecommerce.products
                WHERE (((products.info).base_price)::numeric > (0)::numeric) WITH DATA`
            : dedent`
            CREATE MATERIALIZED VIEW ecommerce.product_pricing AS SELECT id,
                (info).name AS product_name,
                (info).base_price AS base_price,
                category
               FROM ecommerce.products
              WHERE (((info).base_price)::numeric > (0)::numeric) WITH DATA`,
        ],
        expectedMainDependencies: [],
        expectedBranchDependencies: [
          // Type dependencies
          {
            dependent_stable_id: "enum:ecommerce.order_status",
            referenced_stable_id: "schema:ecommerce",
            deptype: "n",
          }, // Enum type depends on schema
          {
            dependent_stable_id: "domain:ecommerce.price",
            referenced_stable_id: "schema:ecommerce",
            deptype: "n",
          }, // Domain type depends on schema
          {
            dependent_stable_id: "compositeType:ecommerce.product_info",
            referenced_stable_id: "schema:ecommerce",
            deptype: "n",
          }, // Composite type depends on schema
          {
            dependent_stable_id: "compositeType:ecommerce.product_info",
            referenced_stable_id: "domain:ecommerce.price",
            deptype: "n",
          }, // Composite type depends on domain
          // Table dependencies
          {
            dependent_stable_id: "table:ecommerce.products",
            referenced_stable_id: "schema:ecommerce",
            deptype: "n",
          }, // Table depends on schema
          {
            dependent_stable_id: "table:ecommerce.products",
            referenced_stable_id: "compositeType:ecommerce.product_info",
            deptype: "n",
          }, // Table depends on composite type
          {
            dependent_stable_id: "table:ecommerce.orders",
            referenced_stable_id: "schema:ecommerce",
            deptype: "n",
          }, // Table depends on schema
          {
            dependent_stable_id: "table:ecommerce.orders",
            referenced_stable_id: "enum:ecommerce.order_status",
            deptype: "n",
          }, // Table depends on enum
          {
            dependent_stable_id: "table:ecommerce.orders",
            referenced_stable_id: "domain:ecommerce.price",
            deptype: "n",
          }, // Table depends on domain
          // Constraint and index dependencies
          {
            dependent_stable_id: "constraint:ecommerce.products.products_pkey",
            referenced_stable_id: "table:ecommerce.products",
            deptype: "a",
          }, // Constraint depends on table
          {
            dependent_stable_id: "constraint:ecommerce.orders.orders_pkey",
            referenced_stable_id: "table:ecommerce.orders",
            deptype: "a",
          }, // Constraint depends on table
          {
            dependent_stable_id: "index:ecommerce.products_pkey",
            referenced_stable_id: "constraint:ecommerce.products.products_pkey",
            deptype: "i",
          }, // Index depends on constraint
          {
            dependent_stable_id: "index:ecommerce.orders_pkey",
            referenced_stable_id: "constraint:ecommerce.orders.orders_pkey",
            deptype: "i",
          }, // Index depends on constraint
          // Materialized view dependencies
          {
            dependent_stable_id: "materializedView:ecommerce.product_pricing",
            referenced_stable_id: "schema:ecommerce",
            deptype: "n",
          }, // Materialized view depends on schema
          {
            dependent_stable_id: "materializedView:ecommerce.product_pricing",
            referenced_stable_id: "table:ecommerce.products",
            deptype: "n",
          }, // Materialized view depends on table
          {
            dependent_stable_id: "materializedView:ecommerce.product_pricing",
            referenced_stable_id: "domain:ecommerce.price",
            deptype: "n",
          }, // Materialized view depends on domain type
          {
            dependent_stable_id: "materializedView:ecommerce.order_summary",
            referenced_stable_id: "schema:ecommerce",
            deptype: "n",
          }, // Materialized view depends on schema
          {
            dependent_stable_id: "materializedView:ecommerce.order_summary",
            referenced_stable_id: "table:ecommerce.orders",
            deptype: "n",
          }, // Materialized view depends on table
          {
            dependent_stable_id: "materializedView:ecommerce.order_summary",
            referenced_stable_id: "enum:ecommerce.order_status",
            deptype: "n",
          }, // Materialized view depends on enum type
        ],
      });
    });

    test("drop type with materialized view dependency", async ({ db }) => {
      await roundtripFidelityTest({
        name: "drop-type-materialized-view-dependency",
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
        CREATE SCHEMA reporting;
        CREATE TYPE reporting.priority AS ENUM ('low', 'medium', 'high');
        CREATE TABLE reporting.tasks (
          id INTEGER PRIMARY KEY,
          title TEXT NOT NULL,
          priority reporting.priority DEFAULT 'medium'
        );
        CREATE MATERIALIZED VIEW reporting.priority_stats AS
        SELECT
          priority,
          COUNT(*) as task_count
        FROM reporting.tasks
        GROUP BY priority;
      `,
        testSql: `
        DROP MATERIALIZED VIEW reporting.priority_stats;
        DROP TABLE reporting.tasks;
        DROP TYPE reporting.priority;
      `,
        description: "drop type with materialized view dependency",
        expectedSqlTerms: [
          "DROP MATERIALIZED VIEW reporting.priority_stats",
          "DROP TABLE reporting.tasks",
          // TODO: should not try to drop the index on the table since it has been dropped already
          "DROP TYPE reporting.priority",
        ],
        expectedMainDependencies: [
          {
            dependent_stable_id: "enum:reporting.priority",
            referenced_stable_id: "schema:reporting",
            deptype: "n",
          }, // Enum type depends on schema
          {
            dependent_stable_id: "table:reporting.tasks",
            referenced_stable_id: "schema:reporting",
            deptype: "n",
          }, // Table depends on schema
          {
            dependent_stable_id: "table:reporting.tasks",
            referenced_stable_id: "enum:reporting.priority",
            deptype: "n",
          }, // Table depends on enum type
          {
            dependent_stable_id: "index:reporting.tasks_pkey",
            referenced_stable_id: "constraint:reporting.tasks.tasks_pkey",
            deptype: "i",
          }, // Index depends on constraint
          {
            dependent_stable_id: "constraint:reporting.tasks.tasks_pkey",
            referenced_stable_id: "table:reporting.tasks",
            deptype: "a",
          }, // Constraint depends on table
          {
            dependent_stable_id: "materializedView:reporting.priority_stats",
            referenced_stable_id: "schema:reporting",
            deptype: "n",
          }, // Materialized view depends on schema
          {
            dependent_stable_id: "materializedView:reporting.priority_stats",
            referenced_stable_id: "table:reporting.tasks",
            deptype: "n",
          }, // Materialized view depends on table
          {
            dependent_stable_id: "materializedView:reporting.priority_stats",
            referenced_stable_id: "enum:reporting.priority",
            deptype: "n",
          }, // Materialized view depends on enum type
        ],
        expectedBranchDependencies: [],
      });
    });

    test("materialized view with range type dependency", async ({ db }) => {
      await roundtripFidelityTest({
        name: "materialized-view-range-dependency",
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "CREATE SCHEMA scheduling;",
        testSql: dedent`
        CREATE TYPE scheduling.time_range AS RANGE (subtype = timestamp);

        CREATE TABLE scheduling.events (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          time_slot scheduling.time_range
        );

        CREATE MATERIALIZED VIEW scheduling.event_durations AS
        SELECT
          name,
          EXTRACT(EPOCH FROM (upper(time_slot) - lower(time_slot))) / 3600 as duration_hours
        FROM scheduling.events
        WHERE time_slot IS NOT NULL;
      `,
        description: "materialized view with range type dependency",
        expectedSqlTerms: [
          "CREATE TYPE scheduling.time_range AS RANGE (SUBTYPE = timestamp(0) without time zone)",
          "CREATE TABLE scheduling.events (id integer NOT NULL, name text NOT NULL, time_slot scheduling.time_range)",
          "ALTER TABLE scheduling.events ADD CONSTRAINT events_pkey PRIMARY KEY (id)",
          pgVersion === 15
            ? dedent`
          CREATE MATERIALIZED VIEW scheduling.event_durations AS SELECT events.name,
              (EXTRACT(epoch FROM (upper(events.time_slot) - lower(events.time_slot))) / (3600)::numeric) AS duration_hours
             FROM scheduling.events
            WHERE (events.time_slot IS NOT NULL) WITH DATA`
            : dedent`
            CREATE MATERIALIZED VIEW scheduling.event_durations AS SELECT name,
                (EXTRACT(epoch FROM (upper(time_slot) - lower(time_slot))) / (3600)::numeric) AS duration_hours
               FROM scheduling.events
              WHERE (time_slot IS NOT NULL) WITH DATA`,
        ],
        expectedMainDependencies: [],
        expectedBranchDependencies: [
          {
            dependent_stable_id: "range:scheduling.time_range",
            referenced_stable_id: "schema:scheduling",
            deptype: "n",
          }, // Range type depends on schema
          {
            dependent_stable_id: "table:scheduling.events",
            referenced_stable_id: "schema:scheduling",
            deptype: "n",
          }, // Table depends on schema
          {
            dependent_stable_id: "table:scheduling.events",
            referenced_stable_id: "range:scheduling.time_range",
            deptype: "n",
          }, // Table depends on range type
          {
            dependent_stable_id: "index:scheduling.events_pkey",
            referenced_stable_id: "constraint:scheduling.events.events_pkey",
            deptype: "i",
          }, // Index depends on constraint
          {
            dependent_stable_id: "constraint:scheduling.events.events_pkey",
            referenced_stable_id: "table:scheduling.events",
            deptype: "a",
          }, // Constraint depends on table
          {
            dependent_stable_id: "materializedView:scheduling.event_durations",
            referenced_stable_id: "schema:scheduling",
            deptype: "n",
          }, // Materialized view depends on schema
          {
            dependent_stable_id: "materializedView:scheduling.event_durations",
            referenced_stable_id: "table:scheduling.events",
            deptype: "n",
          }, // Materialized view depends on table
        ],
      });
    });
  });
}
