import { describe, expect } from "vitest";
import { POSTGRES_VERSIONS } from "../tests/constants.ts";
import { getTest } from "../tests/utils.ts";
import { diffCatalogs } from "./catalog.diff.ts";
import { extractCatalog } from "./catalog.model.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  const test = getTest(pgVersion);

  describe.concurrent(`catalog diff (pg${pgVersion})`, () => {
    test("create schema then composite type", async ({ db }) => {
      await db.branch.unsafe(`
        create schema test_schema;
        create type test_schema.address as (
          street varchar,
          city varchar,
          state varchar
        );
      `);
      const mainCatalog = await extractCatalog(db.main);
      const branchCatalog = await extractCatalog(db.branch);
      const changes = await diffCatalogs(mainCatalog, branchCatalog);
      // Expect the changes to be:
      expect(changes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            operation: "create",
            compositeType: expect.objectContaining({
              name: "address",
              schema: "test_schema",
            }),
          }),
          expect.objectContaining({
            operation: "create",
            schema: expect.objectContaining({
              schema: "test_schema",
            }),
          }),
        ]),
      );
      expect(changes).toHaveLength(2);
    });

    test("create table with columns and constraints", async ({ db }) => {
      await db.branch.unsafe(`
        create schema test_schema;
        create table test_schema.users (
          id serial primary key,
          username varchar(50) unique not null,
          email varchar(255) unique not null,
          created_at timestamp default now()
        );
      `);
      const mainCatalog = await extractCatalog(db.main);
      const branchCatalog = await extractCatalog(db.branch);
      const changes = await diffCatalogs(mainCatalog, branchCatalog);

      expect(changes).toEqual(
        expect.arrayContaining([
          // Remove the two index expectations - unique constraints are handled as table constraints
          expect.objectContaining({
            operation: "create",
            schema: expect.objectContaining({
              schema: "test_schema",
            }),
          }),
          expect.objectContaining({
            operation: "create",
            sequence: expect.objectContaining({
              name: "users_id_seq",
              schema: "test_schema",
            }),
          }),
          expect.objectContaining({
            operation: "alter",
            branch: expect.objectContaining({
              name: "users_id_seq",
              schema: "test_schema",
              owned_by_schema: "test_schema",
              owned_by_table: "users",
              owned_by_column: "id",
            }),
          }),
          expect.objectContaining({
            operation: "create",
            table: expect.objectContaining({
              name: "users",
              schema: "test_schema",
            }),
          }),
          expect.objectContaining({
            operation: "alter",
            table: expect.objectContaining({
              name: "users",
              schema: "test_schema",
            }),
            constraint: expect.objectContaining({
              name: "users_pkey",
            }),
          }),
          expect.objectContaining({
            operation: "alter",
            table: expect.objectContaining({
              name: "users",
              schema: "test_schema",
            }),
            constraint: expect.objectContaining({
              name: "users_username_key",
            }),
          }),
          expect.objectContaining({
            operation: "alter",
            table: expect.objectContaining({
              name: "users",
              schema: "test_schema",
            }),
            constraint: expect.objectContaining({
              name: "users_email_key",
            }),
          }),
        ]),
      );
      expect(changes).toHaveLength(7);
    });

    test("create view", async ({ db }) => {
      await db.branch.unsafe(`
        create schema test_schema;
        create table test_schema.users (
          id serial primary key,
          username varchar(50) not null
        );
        create view test_schema.active_users as
          select id, username from test_schema.users where id > 0;
      `);
      const mainCatalog = await extractCatalog(db.main);
      const branchCatalog = await extractCatalog(db.branch);
      const changes = await diffCatalogs(mainCatalog, branchCatalog);

      expect(changes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            operation: "create",
            schema: expect.objectContaining({
              schema: "test_schema",
            }),
          }),
          expect.objectContaining({
            operation: "create",
            sequence: expect.objectContaining({
              name: "users_id_seq",
              schema: "test_schema",
            }),
          }),
          expect.objectContaining({
            operation: "create",
            table: expect.objectContaining({
              name: "users",
              schema: "test_schema",
            }),
          }),
          expect.objectContaining({
            operation: "alter",
            table: expect.objectContaining({
              name: "users",
              schema: "test_schema",
            }),
            constraint: expect.objectContaining({
              name: "users_pkey",
            }),
          }),
          expect.objectContaining({
            operation: "create",
            view: expect.objectContaining({
              name: "active_users",
              schema: "test_schema",
            }),
          }),
          expect.objectContaining({
            operation: "alter",
            branch: expect.objectContaining({
              name: "users_id_seq",
              schema: "test_schema",
              owned_by_schema: "test_schema",
              owned_by_table: "users",
              owned_by_column: "id",
            }),
          }),
        ]),
      );
      expect(changes).toHaveLength(6);
    });

    test("create sequence", async ({ db }) => {
      await db.branch.unsafe(`
        create schema test_schema;
        create sequence test_schema.user_id_seq
          start with 1000
          increment by 1
          minvalue 1000
          maxvalue 999999
          cache 1;
      `);
      const mainCatalog = await extractCatalog(db.main);
      const branchCatalog = await extractCatalog(db.branch);
      const changes = await diffCatalogs(mainCatalog, branchCatalog);

      expect(changes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            operation: "create",
            schema: expect.objectContaining({
              schema: "test_schema",
            }),
          }),
          expect.objectContaining({
            operation: "create",
            sequence: expect.objectContaining({
              name: "user_id_seq",
              schema: "test_schema",
            }),
          }),
        ]),
      );
      expect(changes).toHaveLength(2);
    });

    test("create enum type", async ({ db }) => {
      await db.branch.unsafe(`
        create schema test_schema;
        create type test_schema.user_status as enum ('active', 'inactive', 'pending');
      `);
      const mainCatalog = await extractCatalog(db.main);
      const branchCatalog = await extractCatalog(db.branch);
      const changes = await diffCatalogs(mainCatalog, branchCatalog);

      expect(changes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            operation: "create",
            enum: expect.objectContaining({
              name: "user_status",
              schema: "test_schema",
            }),
          }),
          expect.objectContaining({
            operation: "create",
            schema: expect.objectContaining({
              schema: "test_schema",
            }),
          }),
        ]),
      );
      expect(changes).toHaveLength(2);
    });

    test("create domain", async ({ db }) => {
      await db.branch.unsafe(`
        create schema test_schema;
        create domain test_schema.email_address as varchar(255)
          constraint email_check check (value ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$');
      `);
      const mainCatalog = await extractCatalog(db.main);
      const branchCatalog = await extractCatalog(db.branch);
      const changes = await diffCatalogs(mainCatalog, branchCatalog);

      expect(changes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            operation: "create",
            domain: expect.objectContaining({
              name: "email_address",
              schema: "test_schema",
            }),
          }),
          expect.objectContaining({
            operation: "create",
            schema: expect.objectContaining({
              schema: "test_schema",
            }),
          }),
        ]),
      );
      expect(changes).toHaveLength(2);
    });

    test("create procedure", async ({ db }) => {
      await db.branch.unsafe(`
        create schema test_schema;
        create or replace procedure test_schema.create_user(
          p_username varchar(50),
          p_email varchar(255)
        )
        language plpgsql
        as $$
        begin
          insert into test_schema.users (username, email) values (p_username, p_email);
        end;
        $$;
      `);
      const mainCatalog = await extractCatalog(db.main);
      const branchCatalog = await extractCatalog(db.branch);
      const changes = await diffCatalogs(mainCatalog, branchCatalog);

      expect(changes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            operation: "create",
            procedure: expect.objectContaining({
              name: "create_user",
              schema: "test_schema",
            }),
          }),
          expect.objectContaining({
            operation: "create",
            schema: expect.objectContaining({
              schema: "test_schema",
            }),
          }),
        ]),
      );
      expect(changes).toHaveLength(2);
    });

    test("create materialized view", async ({ db }) => {
      await db.branch.unsafe(`
        create schema test_schema;
        create table test_schema.users (
          id serial primary key,
          username varchar(50) not null,
          created_at timestamp default now()
        );
        create materialized view test_schema.user_stats as
          select 
            count(*) as total_users,
            date_trunc('day', created_at) as day
          from test_schema.users
          group by date_trunc('day', created_at);
      `);
      const mainCatalog = await extractCatalog(db.main);
      const branchCatalog = await extractCatalog(db.branch);
      const changes = await diffCatalogs(mainCatalog, branchCatalog);

      expect(changes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            operation: "create",
            materializedView: expect.objectContaining({
              name: "user_stats",
              schema: "test_schema",
            }),
          }),
          expect.objectContaining({
            operation: "create",
            schema: expect.objectContaining({
              schema: "test_schema",
            }),
          }),
          expect.objectContaining({
            operation: "create",
            sequence: expect.objectContaining({
              name: "users_id_seq",
              schema: "test_schema",
            }),
          }),
          expect.objectContaining({
            operation: "create",
            table: expect.objectContaining({
              name: "users",
              schema: "test_schema",
            }),
          }),
          expect.objectContaining({
            operation: "alter",
            table: expect.objectContaining({
              name: "users",
              schema: "test_schema",
            }),
            constraint: expect.objectContaining({
              name: "users_pkey",
            }),
          }),
          expect.objectContaining({
            operation: "alter",
            branch: expect.objectContaining({
              name: "users_id_seq",
              schema: "test_schema",
              owned_by_schema: "test_schema",
              owned_by_table: "users",
              owned_by_column: "id",
            }),
          }),
        ]),
      );
      expect(changes).toHaveLength(6);
    });

    test("create trigger", async ({ db }) => {
      await db.branch.unsafe(`
        create schema test_schema;
        create table test_schema.users (
          id serial primary key,
          username varchar(50) not null,
          updated_at timestamp default now()
        );
        create or replace function test_schema.update_updated_at()
        returns trigger as $$
        begin
          new.updated_at = now();
          return new;
        end;
        $$ language plpgsql;
        
        create trigger users_updated_at_trigger
          before update on test_schema.users
          for each row
          execute function test_schema.update_updated_at();
      `);
      const mainCatalog = await extractCatalog(db.main);
      const branchCatalog = await extractCatalog(db.branch);
      const changes = await diffCatalogs(mainCatalog, branchCatalog);

      expect(changes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            operation: "create",
            procedure: expect.objectContaining({
              name: "update_updated_at",
              schema: "test_schema",
            }),
          }),
          expect.objectContaining({
            operation: "create",
            schema: expect.objectContaining({
              schema: "test_schema",
            }),
          }),
          expect.objectContaining({
            operation: "create",
            sequence: expect.objectContaining({
              name: "users_id_seq",
              schema: "test_schema",
            }),
          }),
          expect.objectContaining({
            operation: "create",
            table: expect.objectContaining({
              name: "users",
              schema: "test_schema",
            }),
          }),
          expect.objectContaining({
            operation: "alter",
            table: expect.objectContaining({
              name: "users",
              schema: "test_schema",
            }),
            constraint: expect.objectContaining({
              name: "users_pkey",
            }),
          }),
          expect.objectContaining({
            operation: "create",
            trigger: expect.objectContaining({
              name: "users_updated_at_trigger",
              schema: "test_schema",
            }),
          }),
          expect.objectContaining({
            operation: "alter",
            branch: expect.objectContaining({
              name: "users_id_seq",
              schema: "test_schema",
              owned_by_schema: "test_schema",
              owned_by_table: "users",
              owned_by_column: "id",
            }),
          }),
        ]),
      );
      expect(changes).toHaveLength(7);
    });

    test("create RLS policy", async ({ db }) => {
      await db.branch.unsafe(`
        create schema test_schema;
        create table test_schema.users (
          id serial primary key,
          username varchar(50) not null,
          tenant_id integer not null
        );
        
        alter table test_schema.users enable row level security;
        
        create policy tenant_isolation_policy on test_schema.users
          for all
          using (tenant_id = current_setting('app.tenant_id')::integer);
      `);
      const mainCatalog = await extractCatalog(db.main);
      const branchCatalog = await extractCatalog(db.branch);
      const changes = await diffCatalogs(mainCatalog, branchCatalog);

      expect(changes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            operation: "create",
            rlsPolicy: expect.objectContaining({
              name: "tenant_isolation_policy",
              schema: "test_schema",
            }),
          }),
          expect.objectContaining({
            operation: "create",
            schema: expect.objectContaining({
              schema: "test_schema",
            }),
          }),
          expect.objectContaining({
            operation: "create",
            sequence: expect.objectContaining({
              name: "users_id_seq",
              schema: "test_schema",
            }),
          }),
          expect.objectContaining({
            operation: "create",
            table: expect.objectContaining({
              name: "users",
              schema: "test_schema",
            }),
          }),
          expect.objectContaining({
            operation: "alter",
            table: expect.objectContaining({
              name: "users",
              schema: "test_schema",
            }),
            constraint: expect.objectContaining({
              name: "users_pkey",
            }),
          }),
          expect.objectContaining({
            operation: "alter",
            branch: expect.objectContaining({
              name: "users_id_seq",
              schema: "test_schema",
              owned_by_schema: "test_schema",
              owned_by_table: "users",
              owned_by_column: "id",
            }),
          }),
        ]),
      );
      expect(changes).toHaveLength(6);
    });

    test("complex scenario with multiple entity creations", async ({ db }) => {
      await db.branch.unsafe(`
        create schema test_schema;
        
        -- Create enum
        create type test_schema.user_role as enum ('admin', 'user', 'moderator');
        
        -- Create domain
        create domain test_schema.positive_integer as integer
          constraint positive_check check (value > 0);
        
        -- Create sequence
        create sequence test_schema.global_id_seq start 10000;
        
        -- Create table
        create table test_schema.users (
          id test_schema.positive_integer primary key default nextval('test_schema.global_id_seq'),
          username varchar(50) unique not null,
          role test_schema.user_role default 'user',
          created_at timestamp default now()
        );
        
        -- Create view
        create view test_schema.admin_users as
          select * from test_schema.users where role = 'admin';
        
        -- Create procedure
        create or replace procedure test_schema.create_admin_user(
          p_username varchar(50)
        )
        language plpgsql
        as $$
        begin
          insert into test_schema.users (username, role) values (p_username, 'admin');
        end;
        $$;
      `);
      const mainCatalog = await extractCatalog(db.main);
      const branchCatalog = await extractCatalog(db.branch);
      const changes = await diffCatalogs(mainCatalog, branchCatalog);

      expect(changes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            operation: "create",
            domain: expect.objectContaining({
              name: "positive_integer",
              schema: "test_schema",
            }),
          }),
          expect.objectContaining({
            operation: "create",
            enum: expect.objectContaining({
              name: "user_role",
              schema: "test_schema",
            }),
          }),
          // Remove the index expectation - unique constraints are handled as table constraints
          expect.objectContaining({
            operation: "create",
            procedure: expect.objectContaining({
              name: "create_admin_user",
              schema: "test_schema",
            }),
          }),
          expect.objectContaining({
            operation: "create",
            schema: expect.objectContaining({
              schema: "test_schema",
            }),
          }),
          expect.objectContaining({
            operation: "create",
            sequence: expect.objectContaining({
              name: "global_id_seq",
              schema: "test_schema",
            }),
          }),
          expect.objectContaining({
            operation: "create",
            table: expect.objectContaining({
              name: "users",
              schema: "test_schema",
            }),
          }),
          expect.objectContaining({
            operation: "alter",
            table: expect.objectContaining({
              name: "users",
              schema: "test_schema",
            }),
            constraint: expect.objectContaining({
              name: "users_pkey",
            }),
          }),
          expect.objectContaining({
            operation: "alter",
            table: expect.objectContaining({
              name: "users",
              schema: "test_schema",
            }),
            constraint: expect.objectContaining({
              name: "users_username_key",
            }),
          }),
          expect.objectContaining({
            operation: "create",
            view: expect.objectContaining({
              name: "admin_users",
              schema: "test_schema",
            }),
          }),
        ]),
      );
      expect(changes).toHaveLength(9);
    });

    test("complex scenario with multiple entity drops", async ({ db }) => {
      // Create entities in main database
      await db.main.unsafe(`
        create schema test_schema;
        
        -- Create enum
        create type test_schema.user_role as enum ('admin', 'user', 'moderator');
        
        -- Create domain
        create domain test_schema.positive_integer as integer
          constraint positive_check check (value > 0);
        
        -- Create sequence
        create sequence test_schema.global_id_seq start 10000;
        
        -- Create table
        create table test_schema.users (
          id test_schema.positive_integer primary key default nextval('test_schema.global_id_seq'),
          username varchar(50) unique not null,
          role test_schema.user_role default 'user',
          created_at timestamp default now()
        );
        
        -- Create view
        create view test_schema.admin_users as
          select * from test_schema.users where role = 'admin';
        
        -- Create procedure
        create or replace procedure test_schema.create_admin_user(
          p_username varchar(50)
        )
        language plpgsql
        as $$
        begin
          insert into test_schema.users (username, role) values (p_username, 'admin');
        end;
        $$;
      `);

      // Don't create any entities in branch database (they should be dropped)
      await db.branch.unsafe(`
        -- Branch database is empty, all entities from main should be dropped
      `);

      const mainCatalog = await extractCatalog(db.main);
      const branchCatalog = await extractCatalog(db.branch);
      const changes = await diffCatalogs(mainCatalog, branchCatalog);

      expect(changes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            operation: "drop",
            domain: expect.objectContaining({
              name: "positive_integer",
              schema: "test_schema",
            }),
          }),
          expect.objectContaining({
            operation: "drop",
            enum: expect.objectContaining({
              name: "user_role",
              schema: "test_schema",
            }),
          }),

          expect.objectContaining({
            operation: "drop",
            procedure: expect.objectContaining({
              name: "create_admin_user",
              schema: "test_schema",
            }),
          }),
          expect.objectContaining({
            operation: "drop",
            schema: expect.objectContaining({
              schema: "test_schema",
            }),
          }),
          expect.objectContaining({
            operation: "drop",
            sequence: expect.objectContaining({
              name: "global_id_seq",
              schema: "test_schema",
            }),
          }),
          expect.objectContaining({
            operation: "drop",
            table: expect.objectContaining({
              name: "users",
              schema: "test_schema",
            }),
          }),
          expect.objectContaining({
            operation: "drop",
            view: expect.objectContaining({
              name: "admin_users",
              schema: "test_schema",
            }),
          }),
        ]),
      );
      expect(changes).toHaveLength(7);
    });

    test("complex scenario with multiple entity alter", async ({ db }) => {
      // Create entities in main database
      await db.main.unsafe(`
        create schema test_schema;
        
        -- Create enum with fewer values
        create type test_schema.user_role as enum ('admin', 'user');
        
        -- Create domain without constraint
        create domain test_schema.positive_integer as integer;
        
        -- Create sequence with different start value
        create sequence test_schema.global_id_seq start 1;
        
        -- Create table with fewer columns
        create table test_schema.users (
          id integer primary key,
          username varchar(50) not null
        );
        
        -- Create view with simpler definition
        create view test_schema.admin_users as
          select id, username from test_schema.users where id > 0;
        
        -- Create procedure with different body
        create or replace procedure test_schema.create_admin_user(
          p_username varchar(50)
        )
        language plpgsql
        as $$
        begin
          -- Simple insert
          insert into test_schema.users (username) values (p_username);
        end;
        $$;
      `);

      // Create modified entities in branch database
      await db.branch.unsafe(`
        create schema test_schema;
        
        -- Create enum with more values
        create type test_schema.user_role as enum ('admin', 'user', 'moderator');
        
        -- Create domain with constraint
        create domain test_schema.positive_integer as integer
          constraint positive_check check (value > 0);
        
        -- Create sequence with different start value
        create sequence test_schema.global_id_seq start 10000;
        
        -- Create table with more columns
        create table test_schema.users (
          id integer primary key,
          username varchar(50) not null,
          email varchar(255),
          created_at timestamp default now()
        );
        
        -- Create view with more complex definition
        create view test_schema.admin_users as
          select id, username, email, created_at from test_schema.users where id > 0;
        
        -- Create procedure with different body
        create or replace procedure test_schema.create_admin_user(
          p_username varchar(50)
        )
        language plpgsql
        as $$
        begin
          -- More complex insert with email
          insert into test_schema.users (username, email) values (p_username, p_username || '@example.com');
        end;
        $$;
      `);

      const mainCatalog = await extractCatalog(db.main);
      const branchCatalog = await extractCatalog(db.branch);
      const changes = await diffCatalogs(mainCatalog, branchCatalog);

      // We expect 7 alter operations (1 for enum, 1 for domain, 1 for sequence, 2 for table columns, 1 for view, 1 for procedure)

      // Check that we have alter operations for different entity types
      const alterChanges = changes.filter(
        (change) => change.operation === "alter",
      );
      expect(alterChanges.length).toBeGreaterThan(0);

      // Verify specific alter operations
      expect(changes).toEqual([
        expect.objectContaining({
          operation: "alter",
          domain: expect.objectContaining({
            name: "positive_integer",
            schema: "test_schema",
          }),
          constraint: expect.objectContaining({
            name: "positive_check",
            check_expression: "(VALUE > 0)",
          }),
        }),
        expect.objectContaining({
          operation: "alter",
          main: expect.objectContaining({
            name: "user_role",
            schema: "test_schema",
          }),
          branch: expect.objectContaining({
            name: "user_role",
            schema: "test_schema",
          }),
          newValue: "moderator",
          position: { after: "user" },
        }),
        expect.objectContaining({
          operation: "create",
          orReplace: true,
          procedure: expect.objectContaining({
            name: "create_admin_user",
            schema: "test_schema",
          }),
        }),
        expect.objectContaining({
          operation: "alter",
          main: expect.objectContaining({
            name: "global_id_seq",
            schema: "test_schema",
          }),
          branch: expect.objectContaining({
            name: "global_id_seq",
            schema: "test_schema",
          }),
        }),
        expect.objectContaining({
          operation: "alter",
          table: expect.objectContaining({
            name: "users",
            schema: "test_schema",
          }),
          column: expect.objectContaining({
            name: "email",
          }),
        }),
        expect.objectContaining({
          operation: "alter",
          table: expect.objectContaining({
            name: "users",
            schema: "test_schema",
          }),
          column: expect.objectContaining({
            name: "created_at",
          }),
        }),
        expect.objectContaining({
          operation: "create",
          orReplace: true,
          view: expect.objectContaining({
            name: "admin_users",
            schema: "test_schema",
          }),
        }),
      ]);
      expect(changes).toHaveLength(7);
    });

    test("test enum modification - add new value", async ({ db }) => {
      // Create initial state in main
      await db.main.unsafe(`
        create schema test_schema;
        create type test_schema.status as enum ('active', 'inactive');
      `);

      // Add new value in branch
      await db.branch.unsafe(`
        create schema test_schema;
        create type test_schema.status as enum ('active', 'inactive', 'pending');
      `);

      const mainCatalog = await extractCatalog(db.main);
      const branchCatalog = await extractCatalog(db.branch);
      const changes = await diffCatalogs(mainCatalog, branchCatalog);

      expect(changes).toEqual([
        expect.objectContaining({
          operation: "alter",
          newValue: "pending",
          position: { after: "inactive" },
        }),
      ]);
      expect(changes).toHaveLength(1);
    });

    test("test domain modification - add constraint", async ({ db }) => {
      // Create initial state in main
      await db.main.unsafe(`
        create schema test_schema;
        create domain test_schema.age as integer;
      `);

      // Add constraint in branch
      await db.branch.unsafe(`
        create schema test_schema;
        create domain test_schema.age as integer
          constraint age_check check (value >= 0 and value <= 150);
      `);

      const mainCatalog = await extractCatalog(db.main);
      const branchCatalog = await extractCatalog(db.branch);
      const changes = await diffCatalogs(mainCatalog, branchCatalog);

      expect(changes).toEqual([
        expect.objectContaining({
          operation: "alter",
          domain: expect.objectContaining({
            name: "age",
            schema: "test_schema",
          }),
          constraint: expect.objectContaining({
            name: "age_check",
            check_expression: "((VALUE >= 0) AND (VALUE <= 150))",
          }),
        }),
      ]);
      expect(changes).toHaveLength(1);
    });

    test("test table modification - add column", async ({ db }) => {
      // Create initial state in main
      await db.main.unsafe(`
        create schema test_schema;
        create table test_schema.users (
          id serial primary key,
          username varchar(50) not null
        );
      `);

      // Add column in branch
      await db.branch.unsafe(`
        create schema test_schema;
        create table test_schema.users (
          id serial primary key,
          username varchar(50) not null,
          email varchar(255)
        );
      `);

      const mainCatalog = await extractCatalog(db.main);
      const branchCatalog = await extractCatalog(db.branch);
      const changes = await diffCatalogs(mainCatalog, branchCatalog);

      expect(changes).toEqual([
        expect.objectContaining({
          operation: "alter",
          table: expect.objectContaining({
            name: "users",
            schema: "test_schema",
          }),
          column: expect.objectContaining({
            name: "email",
          }),
        }),
      ]);
      expect(changes).toHaveLength(1);
    });

    test("test view modification - change definition", async ({ db }) => {
      // Create initial state in main
      await db.main.unsafe(`
        create schema test_schema;
        create table test_schema.users (
          id serial primary key,
          username varchar(50) not null,
          role varchar(20) default 'user'
        );
        create view test_schema.user_list as
          select id, username from test_schema.users;
      `);

      // Change view definition in branch
      await db.branch.unsafe(`
        create schema test_schema;
        create table test_schema.users (
          id serial primary key,
          username varchar(50) not null,
          role varchar(20) default 'user'
        );
        create view test_schema.user_list as
          select id, username, role from test_schema.users;
      `);

      const mainCatalog = await extractCatalog(db.main);
      const branchCatalog = await extractCatalog(db.branch);
      const changes = await diffCatalogs(mainCatalog, branchCatalog);

      expect(changes).toEqual([
        expect.objectContaining({
          operation: "create",
          orReplace: true,
          view: expect.objectContaining({
            name: "user_list",
            schema: "test_schema",
            definition:
              pgVersion === 15
                ? " SELECT users.id,\n    users.username,\n    users.role\n   FROM test_schema.users"
                : " SELECT id,\n    username,\n    role\n   FROM test_schema.users",
          }),
        }),
      ]);
      expect(changes).toHaveLength(1);
    });
  });
}
