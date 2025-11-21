/**
 * Integration tests to validate complex multi-dependency ordering theory.
 *
 * This test validates the theory about complex scenarios where multiple
 * changes depend on multiple other changes, testing the overall dependency
 * resolution system.
 */

import { describe } from "vitest";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { getTestIsolated } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  const test = getTestIsolated(pgVersion);

  describe.concurrent(`complex dependency ordering validation (pg${pgVersion})`, () => {
    test("complete e-commerce scenario with all dependency types", async ({
      db,
    }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA ecommerce;
        `,
        testSql: `
          -- Create roles
          CREATE ROLE ecommerce_admin WITH LOGIN;
          CREATE ROLE ecommerce_user WITH LOGIN;
          CREATE ROLE analytics_user WITH LOGIN;
          
          -- Create custom types
          CREATE TYPE ecommerce.order_status AS ENUM ('pending', 'processing', 'shipped', 'delivered', 'cancelled');
          CREATE TYPE ecommerce.priority_level AS ENUM ('low', 'medium', 'high', 'urgent');
          
          -- Create functions
          CREATE OR REPLACE FUNCTION ecommerce.validate_amount(amount decimal)
          RETURNS boolean AS $$
          BEGIN
            RETURN amount > 0 AND amount < 1000000;
          END;
          $$ LANGUAGE plpgsql;
          
          CREATE OR REPLACE FUNCTION ecommerce.calculate_tax(amount decimal)
          RETURNS decimal AS $$
          BEGIN
            RETURN amount * 0.08; -- 8% tax
          END;
          $$ LANGUAGE plpgsql;
          
          -- Create base tables
          CREATE TABLE ecommerce.customers (
            id integer PRIMARY KEY,
            name text NOT NULL,
            email text UNIQUE NOT NULL,
            created_at timestamp DEFAULT now()
          );
          
          CREATE TABLE ecommerce.products (
            id integer PRIMARY KEY,
            name text NOT NULL,
            price decimal NOT NULL,
            category_id integer,
            status text NOT NULL
          );
          
          CREATE TABLE ecommerce.categories (
            id integer PRIMARY KEY,
            name text NOT NULL,
            parent_id integer
          );
          
          CREATE TABLE ecommerce.orders (
            id integer PRIMARY KEY,
            customer_id integer NOT NULL,
            order_date date NOT NULL,
            status text NOT NULL,
            priority text NOT NULL,
            total_amount decimal NOT NULL
          );
          
          CREATE TABLE ecommerce.order_items (
            id integer PRIMARY KEY,
            order_id integer NOT NULL,
            product_id integer NOT NULL,
            quantity integer NOT NULL,
            unit_price decimal NOT NULL
          );
          
          -- Add foreign key constraints
          ALTER TABLE ecommerce.products 
          ADD CONSTRAINT products_category_fkey 
          FOREIGN KEY (category_id) REFERENCES ecommerce.categories(id);
          
          ALTER TABLE ecommerce.categories 
          ADD CONSTRAINT categories_parent_fkey 
          FOREIGN KEY (parent_id) REFERENCES ecommerce.categories(id);
          
          ALTER TABLE ecommerce.orders 
          ADD CONSTRAINT orders_customer_fkey 
          FOREIGN KEY (customer_id) REFERENCES ecommerce.customers(id);
          
          ALTER TABLE ecommerce.order_items 
          ADD CONSTRAINT order_items_order_fkey 
          FOREIGN KEY (order_id) REFERENCES ecommerce.orders(id);
          
          ALTER TABLE ecommerce.order_items 
          ADD CONSTRAINT order_items_product_fkey 
          FOREIGN KEY (product_id) REFERENCES ecommerce.products(id);
          
          -- Add CHECK constraints
          ALTER TABLE ecommerce.orders 
          ADD CONSTRAINT orders_status_valid 
          CHECK (status::ecommerce.order_status IS NOT NULL);
          
          ALTER TABLE ecommerce.orders 
          ADD CONSTRAINT orders_priority_valid 
          CHECK (priority::ecommerce.priority_level IS NOT NULL);
          
          ALTER TABLE ecommerce.orders 
          ADD CONSTRAINT orders_amount_valid 
          CHECK (ecommerce.validate_amount(total_amount));
          
          ALTER TABLE ecommerce.order_items 
          ADD CONSTRAINT order_items_quantity_valid 
          CHECK (quantity > 0);
          
          ALTER TABLE ecommerce.order_items 
          ADD CONSTRAINT order_items_price_valid 
          CHECK (ecommerce.validate_amount(unit_price));
          
          -- Create views
          CREATE VIEW ecommerce.customer_orders AS
          SELECT 
            c.id as customer_id,
            c.name as customer_name,
            c.email,
            COUNT(o.id) as order_count,
            SUM(o.total_amount) as total_spent
          FROM ecommerce.customers c
          LEFT JOIN ecommerce.orders o ON c.id = o.customer_id
          GROUP BY c.id, c.name, c.email;
          
          CREATE VIEW ecommerce.product_sales AS
          SELECT 
            p.id as product_id,
            p.name as product_name,
            SUM(oi.quantity) as total_sold,
            SUM(oi.quantity * oi.unit_price) as total_revenue
          FROM ecommerce.products p
          LEFT JOIN ecommerce.order_items oi ON p.id = oi.product_id
          GROUP BY p.id, p.name;
          
          -- Create materialized view
          CREATE MATERIALIZED VIEW ecommerce.daily_sales AS
          SELECT 
            order_date,
            COUNT(*) as order_count,
            SUM(total_amount) as total_revenue,
            AVG(total_amount) as avg_order_value
          FROM ecommerce.orders
          GROUP BY order_date;
          
          -- Create indexes
          CREATE INDEX idx_orders_customer_date ON ecommerce.orders(customer_id, order_date);
          CREATE INDEX idx_orders_status ON ecommerce.orders(status);
          CREATE INDEX idx_order_items_order ON ecommerce.order_items(order_id);
          CREATE INDEX idx_products_category ON ecommerce.products(category_id);
          CREATE INDEX idx_categories_parent ON ecommerce.categories(parent_id);
          
          -- Change owners
          ALTER TABLE ecommerce.customers OWNER TO ecommerce_admin;
          ALTER TABLE ecommerce.products OWNER TO ecommerce_admin;
          ALTER TABLE ecommerce.categories OWNER TO ecommerce_admin;
          ALTER TABLE ecommerce.orders OWNER TO ecommerce_user;
          ALTER TABLE ecommerce.order_items OWNER TO ecommerce_user;
          ALTER VIEW ecommerce.customer_orders OWNER TO analytics_user;
          ALTER VIEW ecommerce.product_sales OWNER TO analytics_user;
          ALTER MATERIALIZED VIEW ecommerce.daily_sales OWNER TO analytics_user;
        `,
      });
    });

    test("circular dependency scenario - should fail gracefully", async ({
      db,
    }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
        `,
        testSql: `
          -- Create tables that will have circular dependencies
          CREATE TABLE test_schema.table_a (
            id integer PRIMARY KEY,
            b_id integer
          );
          
          CREATE TABLE test_schema.table_b (
            id integer PRIMARY KEY,
            a_id integer
          );
          
          -- Add foreign key constraints that create a circular dependency
          ALTER TABLE test_schema.table_a 
          ADD CONSTRAINT table_a_b_fkey 
          FOREIGN KEY (b_id) REFERENCES test_schema.table_b(id);
          
          ALTER TABLE test_schema.table_b 
          ADD CONSTRAINT table_b_a_fkey 
          FOREIGN KEY (a_id) REFERENCES test_schema.table_a(id);
        `,
      });
    });

    test("mixed operation types with complex dependencies", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          
          -- Create initial state
          CREATE TABLE test_schema.base_table (
            id integer PRIMARY KEY,
            name text NOT NULL
          );
          
          CREATE ROLE existing_role WITH LOGIN;
        `,
        testSql: `
          -- Create new role
          CREATE ROLE new_role WITH LOGIN;
          
          -- Create new type
          CREATE TYPE test_schema.status_enum AS ENUM ('active', 'inactive');
          
          -- Create new function
          CREATE OR REPLACE FUNCTION test_schema.validate_name(name text)
          RETURNS boolean AS $$
          BEGIN
            RETURN length(name) > 0 AND length(name) <= 100;
          END;
          $$ LANGUAGE plpgsql;
          
          -- Create new table
          CREATE TABLE test_schema.new_table (
            id integer PRIMARY KEY,
            base_id integer NOT NULL,
            name text NOT NULL,
            status text NOT NULL
          );
          
          -- Add foreign key constraint
          ALTER TABLE test_schema.new_table 
          ADD CONSTRAINT new_table_base_fkey 
          FOREIGN KEY (base_id) REFERENCES test_schema.base_table(id);
          
          -- Add CHECK constraints
          ALTER TABLE test_schema.new_table 
          ADD CONSTRAINT new_table_name_valid 
          CHECK (test_schema.validate_name(name));
          
          ALTER TABLE test_schema.new_table 
          ADD CONSTRAINT new_table_status_valid 
          CHECK (status::test_schema.status_enum IS NOT NULL);
          
          -- Create view
          CREATE VIEW test_schema.combined_view AS
          SELECT 
            bt.id as base_id,
            bt.name as base_name,
            nt.id as new_id,
            nt.name as new_name,
            nt.status
          FROM test_schema.base_table bt
          JOIN test_schema.new_table nt ON bt.id = nt.base_id;
          
          -- Change owners
          ALTER TABLE test_schema.base_table OWNER TO existing_role;
          ALTER TABLE test_schema.new_table OWNER TO new_role;
          ALTER VIEW test_schema.combined_view OWNER TO new_role;
        `,
      });
    });
  });
}
