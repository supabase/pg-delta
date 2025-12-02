/**
 * Integration tests for PostgreSQL partitioned table operations.
 * Tests that indexes, triggers, and foreign keys are correctly handled
 * for partitioned tables (not duplicated on partitions).
 */

import dedent from "dedent";
import { describe } from "vitest";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { getTest } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  const test = getTest(pgVersion);

  describe.concurrent(`partitioned table operations (pg${pgVersion})`, () => {
    test("partitioned table with indexes on parent", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.orders (
            order_id integer NOT NULL,
            created_on date NOT NULL,
            customer_id integer,
            status text,
            amount numeric(10,2)
          ) PARTITION BY RANGE (created_on);

          CREATE TABLE test_schema.orders_2024 PARTITION OF test_schema.orders
          FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');

          CREATE TABLE test_schema.orders_2025 PARTITION OF test_schema.orders
          FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
        `,
        testSql: `
          -- Indexes on parent should propagate to partitions, not be created separately
          CREATE INDEX idx_orders_status ON test_schema.orders (status);
          CREATE INDEX idx_orders_customer ON test_schema.orders (customer_id);
          CREATE INDEX idx_orders_created_brin ON test_schema.orders USING brin (created_on);
        `,
        expectedSqlTerms: [
          "CREATE INDEX idx_orders_status ON test_schema.orders (status)",
          "CREATE INDEX idx_orders_customer ON test_schema.orders (customer_id)",
          "CREATE INDEX idx_orders_created_brin ON test_schema.orders USING brin (created_on)",
        ],
      });
    });

    test("partitioned table with triggers on parent", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.events (
            event_id integer NOT NULL,
            created_at timestamp NOT NULL,
            data jsonb
          ) PARTITION BY RANGE (created_at);

          CREATE TABLE test_schema.events_2024 PARTITION OF test_schema.events
          FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');

          CREATE TABLE test_schema.events_2025 PARTITION OF test_schema.events
          FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');

          CREATE FUNCTION test_schema.update_timestamp()
          RETURNS trigger
          LANGUAGE plpgsql
          AS $$
          BEGIN
            RETURN NEW;
          END;
          $$;

          CREATE FUNCTION test_schema.audit_event()
          RETURNS trigger
          LANGUAGE plpgsql
          AS $$
          BEGIN
            RETURN NEW;
          END;
          $$;
        `,
        testSql: `
          -- Triggers on parent should propagate to partitions, not be created separately
          CREATE TRIGGER trg_events_updated_at
          BEFORE UPDATE ON test_schema.events
          FOR EACH ROW
          EXECUTE FUNCTION test_schema.update_timestamp();

          CREATE TRIGGER trg_events_audit
          AFTER INSERT OR UPDATE OR DELETE ON test_schema.events
          FOR EACH ROW
          EXECUTE FUNCTION test_schema.audit_event();
        `,
        expectedSqlTerms: [
          "CREATE TRIGGER trg_events_audit AFTER INSERT OR DELETE OR UPDATE ON test_schema.events FOR EACH ROW EXECUTE FUNCTION test_schema.audit_event()",
          "CREATE TRIGGER trg_events_updated_at BEFORE UPDATE ON test_schema.events FOR EACH ROW EXECUTE FUNCTION test_schema.update_timestamp()",
        ],
      });
    });

    test("foreign key referencing partitioned table", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.customers (
            customer_id integer PRIMARY KEY,
            name text
          );

          CREATE TABLE test_schema.orders (
            order_id integer NOT NULL,
            created_on date NOT NULL,
            customer_id integer,
            PRIMARY KEY (order_id, created_on)
          ) PARTITION BY RANGE (created_on);

          CREATE TABLE test_schema.orders_2024 PARTITION OF test_schema.orders
          FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');

          CREATE TABLE test_schema.orders_2025 PARTITION OF test_schema.orders
          FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
        `,
        testSql: `
          CREATE TABLE test_schema.order_items (
            item_id integer PRIMARY KEY,
            order_id integer NOT NULL,
            order_created_on date NOT NULL,
            product_name text
          );

          -- Foreign key should reference parent table, not individual partitions
          ALTER TABLE test_schema.order_items
          ADD CONSTRAINT fk_order_items_order
          FOREIGN KEY (order_id, order_created_on)
          REFERENCES test_schema.orders(order_id, created_on)
          ON DELETE CASCADE;
        `,
        expectedSqlTerms: [
          "CREATE TABLE test_schema.order_items (item_id integer NOT NULL, order_id integer NOT NULL, order_created_on date NOT NULL, product_name text)",
          "ALTER TABLE test_schema.order_items ADD CONSTRAINT fk_order_items_order FOREIGN KEY (order_id, order_created_on) REFERENCES test_schema.orders(order_id, created_on) ON DELETE CASCADE",
          "ALTER TABLE test_schema.order_items ADD CONSTRAINT order_items_pkey PRIMARY KEY (item_id)",
        ],
      });
    });

    test("comprehensive partitioned table with all features", async ({
      db,
    }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: dedent`
          CREATE SCHEMA test_schema;
          
          -- Reference table
          CREATE TABLE test_schema.customers (
            customer_id integer PRIMARY KEY,
            name text NOT NULL
          );

          -- Partitioned table
          CREATE TABLE test_schema.orders (
            order_id integer NOT NULL,
            created_on date NOT NULL,
            customer_id integer NOT NULL,
            status text DEFAULT 'pending',
            total_amount numeric(10,2),
            updated_at timestamp DEFAULT now(),
            PRIMARY KEY (order_id, created_on)
          ) PARTITION BY RANGE (created_on);

          CREATE TABLE test_schema.orders_2024 PARTITION OF test_schema.orders
          FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');

          CREATE TABLE test_schema.orders_2025 PARTITION OF test_schema.orders
          FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');

          -- Helper functions
          CREATE FUNCTION test_schema.update_updated_at()
          RETURNS trigger
          LANGUAGE plpgsql
          AS $$
          BEGIN
            NEW.updated_at = now();
            RETURN NEW;
          END;
          $$;

          CREATE FUNCTION test_schema.log_order_changes()
          RETURNS trigger
          LANGUAGE plpgsql
          AS $$
          BEGIN
            RETURN NEW;
          END;
          $$;
        `,
        testSql: dedent`
          -- Foreign key to partitioned table (should reference parent only)
          ALTER TABLE test_schema.orders
          ADD CONSTRAINT fk_orders_customer
          FOREIGN KEY (customer_id)
          REFERENCES test_schema.customers(customer_id)
          ON DELETE RESTRICT;

          -- Indexes on parent (should propagate to partitions, not be created separately)
          CREATE INDEX idx_orders_status ON test_schema.orders (status);
          CREATE INDEX idx_orders_customer ON test_schema.orders (customer_id);
          CREATE INDEX idx_orders_created_brin ON test_schema.orders USING brin (created_on);

          -- Triggers on parent (should propagate to partitions, not be created separately)
          CREATE TRIGGER trg_orders_updated_at
          BEFORE UPDATE ON test_schema.orders
          FOR EACH ROW
          EXECUTE FUNCTION test_schema.update_updated_at();

          CREATE TRIGGER trg_orders_audit
          AFTER INSERT OR UPDATE OR DELETE ON test_schema.orders
          FOR EACH ROW
          EXECUTE FUNCTION test_schema.log_order_changes();

          -- Child table with FK to partitioned table
          CREATE TABLE test_schema.order_items (
            item_id integer PRIMARY KEY,
            order_id integer NOT NULL,
            order_created_on date NOT NULL,
            product_name text,
            quantity integer
          );

          -- Foreign key should reference parent table, not partitions
          ALTER TABLE test_schema.order_items
          ADD CONSTRAINT fk_order_items_order
          FOREIGN KEY (order_id, order_created_on)
          REFERENCES test_schema.orders(order_id, created_on)
          ON DELETE CASCADE;
        `,
        expectedSqlTerms: [
          "CREATE TABLE test_schema.order_items (item_id integer NOT NULL, order_id integer NOT NULL, order_created_on date NOT NULL, product_name text, quantity integer)",
          "ALTER TABLE test_schema.order_items ADD CONSTRAINT fk_order_items_order FOREIGN KEY (order_id, order_created_on) REFERENCES test_schema.orders(order_id, created_on) ON DELETE CASCADE",
          "ALTER TABLE test_schema.order_items ADD CONSTRAINT order_items_pkey PRIMARY KEY (item_id)",
          "ALTER TABLE test_schema.orders ADD CONSTRAINT fk_orders_customer FOREIGN KEY (customer_id) REFERENCES test_schema.customers(customer_id) ON DELETE RESTRICT",
          "CREATE INDEX idx_orders_status ON test_schema.orders (status)",
          "CREATE INDEX idx_orders_customer ON test_schema.orders (customer_id)",
          "CREATE INDEX idx_orders_created_brin ON test_schema.orders USING brin (created_on)",
          "CREATE TRIGGER trg_orders_audit AFTER INSERT OR DELETE OR UPDATE ON test_schema.orders FOR EACH ROW EXECUTE FUNCTION test_schema.log_order_changes()",
          "CREATE TRIGGER trg_orders_updated_at BEFORE UPDATE ON test_schema.orders FOR EACH ROW EXECUTE FUNCTION test_schema.update_updated_at()",
        ],
      });
    });

    test("partitioned table with unique constraint including partition key", async ({
      db,
    }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.products (
            product_id integer NOT NULL,
            created_on date NOT NULL,
            sku text,
            name text,
            PRIMARY KEY (product_id, created_on)
          ) PARTITION BY RANGE (created_on);

          CREATE TABLE test_schema.products_2024 PARTITION OF test_schema.products
          FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');

          CREATE TABLE test_schema.products_2025 PARTITION OF test_schema.products
          FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
        `,
        testSql: `
          -- Unique constraint on parent must include partition key (should propagate to partitions)
          ALTER TABLE test_schema.products
          ADD CONSTRAINT products_sku_key UNIQUE (sku, created_on);
        `,
        expectedSqlTerms: [
          "ALTER TABLE test_schema.products ADD CONSTRAINT products_sku_key UNIQUE (sku, created_on)",
        ],
      });
    });

    test("adding partition to existing partitioned table with indexes and triggers", async ({
      db,
    }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.events (
            event_id integer NOT NULL,
            created_at timestamp NOT NULL,
            data jsonb,
            PRIMARY KEY (event_id, created_at)
          ) PARTITION BY RANGE (created_at);

          CREATE TABLE test_schema.events_2024 PARTITION OF test_schema.events
          FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');

          CREATE INDEX idx_events_created ON test_schema.events (created_at);
          
          CREATE FUNCTION test_schema.audit_event()
          RETURNS trigger
          LANGUAGE plpgsql
          AS $$
          BEGIN
            RETURN NEW;
          END;
          $$;

          CREATE TRIGGER trg_events_audit
          AFTER INSERT OR UPDATE OR DELETE ON test_schema.events
          FOR EACH ROW
          EXECUTE FUNCTION test_schema.audit_event();

          -- Pre-create the 2025 partition in main to test adding it in branch
          CREATE TABLE test_schema.events_2025 PARTITION OF test_schema.events
          FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
        `,
        testSql: `
          -- Adding a new partition should not recreate indexes/triggers on existing partitions
          -- This test verifies that when a partition already exists, we don't try to recreate
          -- indexes/triggers that were already propagated from the parent
        `,
      });
    });
  });
}
