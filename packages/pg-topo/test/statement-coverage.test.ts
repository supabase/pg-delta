import { describe, expect, test } from "bun:test";
import { analyzeAndSort } from "../src/analyze-and-sort";
import { validateAnalyzeResultWithPostgres } from "./support/postgres-validation";

describe("statement coverage", () => {
  test("orders enum type before table using it", async () => {
    const result = await analyzeAndSort([
      "create table app.users(id int primary key, role app.user_role not null);",
      "create type app.user_role as enum ('admin', 'user');",
      "create schema app;",
    ]);
    const unknownCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNKNOWN_STATEMENT_CLASS",
    ).length;
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );

    expect(unknownCount).toBe(0);
    expect(unresolvedCount).toBe(0);
    expect(orderedSql[0]).toContain("create schema app");
    expect(orderedSql[1]).toContain("create type app.user_role");
    expect(orderedSql[2]).toContain("create table app.users");
  });

  test("orders range type before table using it", async () => {
    const result = await analyzeAndSort([
      "create table app.events(id int primary key, during app.int_range not null);",
      "create type app.int_range as range (subtype = int4);",
      "create schema app;",
    ]);
    const unknownCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNKNOWN_STATEMENT_CLASS",
    ).length;
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );

    expect(unknownCount).toBe(0);
    expect(unresolvedCount).toBe(0);
    expect(orderedSql[0]).toContain("create schema app");
    expect(orderedSql[1]).toContain("create type app.int_range");
    expect(orderedSql[2]).toContain("create table app.events");
  });

  test("orders range type after custom subtype", async () => {
    const result = await analyzeAndSort([
      "create type app.price_range as range (subtype = app.price);",
      "create domain app.price as numeric check (value >= 0);",
      "create schema app;",
    ]);
    const unknownCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNKNOWN_STATEMENT_CLASS",
    ).length;
    const unresolvedDiagnostics = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const schemaIndex = orderedSql.findIndex((sql) =>
      sql.includes("create schema app"),
    );
    const subtypeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create domain app.price"),
    );
    const rangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.price_range"),
    );

    expect(unknownCount).toBe(0);
    expect(unresolvedDiagnostics).toHaveLength(0);
    expect(schemaIndex).toBeGreaterThan(-1);
    expect(subtypeIndex).toBeGreaterThan(schemaIndex);
    expect(rangeIndex).toBeGreaterThan(subtypeIndex);
  });

  test("orders range type after canonical and subtype_diff functions", async () => {
    const result = await analyzeAndSort([
      "create type app.positive_int_range as range (subtype = int4, canonical = app.positive_int_range_canonical, subtype_diff = app.positive_int_range_subdiff);",
      "create function app.positive_int_range_subdiff(a int4, b int4) returns float8 language sql immutable as 'select (a - b)::float8';",
      "create function app.positive_int_range_canonical(value app.positive_int_range) returns app.positive_int_range language internal immutable as 'int4range_canonical';",
      "create type app.positive_int_range;",
      "create schema app;",
    ]);
    const unknownCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNKNOWN_STATEMENT_CLASS",
    ).length;
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const canonicalIndex = orderedSql.findIndex((sql) =>
      sql.includes("positive_int_range_canonical"),
    );
    const subtypeDiffIndex = orderedSql.findIndex((sql) =>
      sql.includes("positive_int_range_subdiff"),
    );
    const rangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.positive_int_range as range"),
    );

    expect(unknownCount).toBe(0);
    expect(unresolvedCount).toBe(0);
    expect(canonicalIndex).toBeGreaterThan(-1);
    expect(subtypeDiffIndex).toBeGreaterThan(-1);
    expect(rangeIndex).toBeGreaterThan(canonicalIndex);
    expect(rangeIndex).toBeGreaterThan(subtypeDiffIndex);
  });

  test("orders create role/schema before schema grant", async () => {
    const result = await analyzeAndSort([
      "grant usage on schema app to app_user;",
      "create schema app;",
      "create role app_user;",
    ]);
    const unknownCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNKNOWN_STATEMENT_CLASS",
    ).length;
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );

    expect(unknownCount).toBe(0);
    expect(unresolvedCount).toBe(0);
    expect(orderedSql[0]).toContain("create role app_user");
    expect(orderedSql[1]).toContain("create schema app");
    expect(orderedSql[2]).toContain("grant usage on schema app to app_user");
  });

  test("orders table before publication, comment, and owner changes", async () => {
    const result = await analyzeAndSort([
      "create publication pub_users for table app.users;",
      "comment on table app.users is 'users table';",
      "alter table app.users owner to app_user;",
      "create table app.users(id int primary key);",
      "create schema app;",
      "create role app_user;",
    ]);
    const unknownCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNKNOWN_STATEMENT_CLASS",
    ).length;
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;

    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const tableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table app.users"),
    );
    const publicationIndex = orderedSql.findIndex((sql) =>
      sql.includes("create publication pub_users"),
    );
    const commentIndex = orderedSql.findIndex((sql) =>
      sql.includes("comment on table app.users"),
    );
    const ownerIndex = orderedSql.findIndex((sql) =>
      sql.includes("alter table app.users owner"),
    );

    expect(unknownCount).toBe(0);
    expect(unresolvedCount).toBe(0);
    expect(tableIndex).toBeGreaterThan(-1);
    expect(publicationIndex).toBeGreaterThan(tableIndex);
    expect(commentIndex).toBeGreaterThan(tableIndex);
    expect(ownerIndex).toBeGreaterThan(tableIndex);
  });

  test("orders referenced unique key provider before foreign key consumers", async () => {
    const result = await analyzeAndSort([
      "create table public.oauth_apps(id uuid primary key, created_by uuid references public.users(gotrue_id));",
      "create table public.users(id bigint primary key, gotrue_id uuid not null);",
      "create unique index users_gotrue_id_key on public.users using btree (gotrue_id);",
    ]);
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const usersTableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table public.users"),
    );
    const usersUniqueIndex = orderedSql.findIndex((sql) =>
      sql.includes("create unique index users_gotrue_id_key"),
    );
    const oauthAppsIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table public.oauth_apps"),
    );

    expect(unresolvedCount).toBe(0);
    expect(usersTableIndex).toBeGreaterThan(-1);
    expect(usersUniqueIndex).toBeGreaterThan(usersTableIndex);
    expect(oauthAppsIndex).toBeGreaterThan(usersUniqueIndex);
  });

  test("prioritizes foundational bootstrap classes before generic bootstrap statements", async () => {
    const result = await analyzeAndSort([
      "do $$ begin perform 1; end $$;",
      "set check_function_bodies = off;",
      'create extension if not exists "uuid-ossp";',
      "create schema app;",
      "create role app_user;",
    ]);
    const orderedClasses = result.ordered.map(
      (statement) => statement.statementClass,
    );

    expect(orderedClasses).toEqual([
      "CREATE_ROLE",
      "CREATE_SCHEMA",
      "CREATE_EXTENSION",
      "VARIABLE_SET",
      "DO",
    ]);
  });

  test("orders function with default params before view that calls it with fewer args", async () => {
    const result = await analyzeAndSort([
      "create schema app;",
      "create type app.action as enum ('read', 'write');",
      "create function app.check_access(org_id bigint, resource text, action app.action, data json default null, subject uuid default gen_random_uuid()) returns boolean language sql stable as $$ select true $$;",
      "create table app.items(org_id bigint, name text);",
      "create view app.visible_items as select * from app.items where app.check_access(org_id, 'items', 'read'::app.action);",
    ]);
    const unresolvedDeps = result.diagnostics.filter(
      (d) => d.code === "UNRESOLVED_DEPENDENCY",
    );
    const orderedSql = result.ordered.map((s) => s.sql.toLowerCase());
    const fnIndex = orderedSql.findIndex((sql) => sql.includes("check_access"));
    const viewIndex = orderedSql.findIndex((sql) =>
      sql.includes("visible_items"),
    );

    expect(unresolvedDeps).toHaveLength(0);
    expect(fnIndex).toBeGreaterThan(-1);
    expect(viewIndex).toBeGreaterThan(fnIndex);
  });

  test("orders create rule after target table and WHERE predicate function", async () => {
    const result = await analyzeAndSort([
      "create rule users_insert_guard as on insert to app.users where app.allow_insert(new.owner_id) do instead nothing;",
      "create function app.allow_insert(owner_id int) returns boolean language sql immutable as $$ select true $$;",
      "create table app.users(id int primary key, owner_id int not null);",
      "create schema app;",
    ]);
    const unknownDiagnostics = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNKNOWN_STATEMENT_CLASS",
    );
    const unresolvedDiagnostics = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const functionIndex = orderedSql.findIndex((sql) =>
      sql.includes("create function app.allow_insert"),
    );
    const tableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table app.users"),
    );
    const ruleIndex = orderedSql.findIndex((sql) =>
      sql.includes("create rule users_insert_guard"),
    );
    const ruleStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("users_insert_guard"),
    );
    const validation = await validateAnalyzeResultWithPostgres(result);

    expect(unknownDiagnostics).toHaveLength(0);
    expect(unresolvedDiagnostics).toHaveLength(0);
    expect(ruleStatement?.provides).toContainEqual({
      kind: "rule",
      schema: "app",
      name: "users.users_insert_guard",
    });
    expect(tableIndex).toBeGreaterThan(-1);
    expect(functionIndex).toBeGreaterThan(tableIndex);
    expect(ruleIndex).toBeGreaterThan(functionIndex);
    expect(validation.diagnostics).toHaveLength(0);
  }, 120000);

  test("orders create rule after action query function and relations", async () => {
    const result = await analyzeAndSort([
      "create rule incoming_users_insert as on insert to app.incoming_users do instead insert into app.users(owner_id, normalized_name) values (new.owner_id, app.normalize_name(new.raw_name));",
      "create table app.users(id int generated always as identity primary key, owner_id int not null, normalized_name text not null);",
      "create function app.normalize_name(value text) returns text language sql immutable as $$ select lower(value) $$;",
      "create schema app;",
      "create table app.incoming_users(owner_id int not null, raw_name text not null);",
    ]);
    const unknownDiagnostics = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNKNOWN_STATEMENT_CLASS",
    );
    const unresolvedDiagnostics = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const targetTableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table app.incoming_users"),
    );
    const actionTableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table app.users"),
    );
    const functionIndex = orderedSql.findIndex((sql) =>
      sql.includes("create function app.normalize_name"),
    );
    const ruleIndex = orderedSql.findIndex((sql) =>
      sql.includes("create rule incoming_users_insert"),
    );
    const validation = await validateAnalyzeResultWithPostgres(result);

    expect(unknownDiagnostics).toHaveLength(0);
    expect(unresolvedDiagnostics).toHaveLength(0);
    expect(targetTableIndex).toBeGreaterThan(-1);
    expect(actionTableIndex).toBeGreaterThan(-1);
    expect(functionIndex).toBeGreaterThan(actionTableIndex);
    expect(ruleIndex).toBeGreaterThan(targetTableIndex);
    expect(ruleIndex).toBeGreaterThan(functionIndex);
    expect(validation.diagnostics).toHaveLength(0);
  }, 120000);

  test("orders create rule without expressions after its relation", async () => {
    const result = await analyzeAndSort([
      "create rule users_delete_guard as on delete to app.users do instead nothing;",
      "create table app.users(id int primary key);",
      "create schema app;",
    ]);
    const unknownDiagnostics = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNKNOWN_STATEMENT_CLASS",
    );
    const unresolvedDiagnostics = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const tableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table app.users"),
    );
    const ruleIndex = orderedSql.findIndex((sql) =>
      sql.includes("create rule users_delete_guard"),
    );
    const validation = await validateAnalyzeResultWithPostgres(result);

    expect(unknownDiagnostics).toHaveLength(0);
    expect(unresolvedDiagnostics).toHaveLength(0);
    expect(tableIndex).toBeGreaterThan(-1);
    expect(ruleIndex).toBeGreaterThan(tableIndex);
    expect(validation.diagnostics).toHaveLength(0);
  }, 120000);

  test("orders comment on rule after the rule it targets", async () => {
    const result = await analyzeAndSort([
      "comment on rule users_delete_guard on app.users is 'guard rule';",
      "create rule users_delete_guard as on delete to app.users do instead nothing;",
      "create table app.users(id int primary key);",
      "create schema app;",
    ]);
    const unknownDiagnostics = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNKNOWN_STATEMENT_CLASS",
    );
    const unresolvedDiagnostics = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const ruleIndex = orderedSql.findIndex((sql) =>
      sql.includes("create rule users_delete_guard"),
    );
    const commentIndex = orderedSql.findIndex((sql) =>
      sql.includes("comment on rule users_delete_guard"),
    );
    const commentStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("comment on rule"),
    );
    const validation = await validateAnalyzeResultWithPostgres(result);

    expect(unknownDiagnostics).toHaveLength(0);
    expect(unresolvedDiagnostics).toHaveLength(0);
    expect(commentStatement?.requires).toContainEqual({
      kind: "rule",
      schema: "app",
      name: "users.users_delete_guard",
    });
    expect(ruleIndex).toBeGreaterThan(-1);
    expect(commentIndex).toBeGreaterThan(ruleIndex);
    expect(validation.diagnostics).toHaveLength(0);
  }, 120000);

  test("orders comment on a view's implicit _RETURN rule after the view", async () => {
    const result = await analyzeAndSort([
      "comment on rule \"_RETURN\" on app.v is 'implicit view rule';",
      "create view app.v as select 1 as one;",
      "create schema app;",
    ]);
    const unknownDiagnostics = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNKNOWN_STATEMENT_CLASS",
    );
    const unresolvedDiagnostics = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const viewIndex = orderedSql.findIndex((sql) =>
      sql.includes("create view app.v"),
    );
    const commentIndex = orderedSql.findIndex((sql) =>
      sql.includes('comment on rule "_return"'),
    );
    const viewStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create view app.v"),
    );
    const validation = await validateAnalyzeResultWithPostgres(result);

    expect(unknownDiagnostics).toHaveLength(0);
    expect(unresolvedDiagnostics).toHaveLength(0);
    expect(viewStatement?.provides).toContainEqual({
      kind: "rule",
      schema: "app",
      name: "v._RETURN",
    });
    expect(viewIndex).toBeGreaterThan(-1);
    expect(commentIndex).toBeGreaterThan(viewIndex);
    expect(validation.diagnostics).toHaveLength(0);
  }, 120000);

  test("resolves correct overload when multiple overloads have defaults", async () => {
    const result = await analyzeAndSort([
      "create schema auth;",
      "create type auth.action as enum ('read', 'write');",
      "create function auth.can(org_id bigint, resource text, action auth.action, data json default null, subject uuid default gen_random_uuid()) returns boolean language sql stable as $$ select true $$;",
      "create function auth.can(org_id bigint, project_id bigint, resource text, action auth.action, data json default null, subject uuid default gen_random_uuid()) returns boolean language sql stable as $$ select true $$;",
      "create table public.orgs(id bigint primary key, name text);",
      "create view public.billing as select * from public.orgs where auth.can(id, 'billing', 'read'::auth.action);",
    ]);
    const unresolvedDeps = result.diagnostics.filter(
      (d) => d.code === "UNRESOLVED_DEPENDENCY",
    );
    const orderedSql = result.ordered.map((s) => s.sql.toLowerCase());
    const fn5Index = orderedSql.findIndex(
      (sql) =>
        sql.includes("auth.can") &&
        sql.includes("resource text") &&
        !sql.includes("project_id"),
    );
    const viewIndex = orderedSql.findIndex((sql) =>
      sql.includes("create view public.billing"),
    );

    expect(unresolvedDeps).toHaveLength(0);
    expect(fn5Index).toBeGreaterThan(-1);
    expect(viewIndex).toBeGreaterThan(fn5Index);
  });

  test("creates edges to all matching overloads with prefix matching", async () => {
    const result = await analyzeAndSort([
      "create schema app;",
      "create function app.do_thing(a int) returns void language sql as $$ select null $$;",
      "create function app.do_thing(a int, b text) returns void language sql as $$ select null $$;",
      "create table app.items(val int);",
      "create view app.processed as select app.do_thing(val) from app.items;",
    ]);
    const orderedSql = result.ordered.map((s) => s.sql.toLowerCase());
    const fn1Index = orderedSql.findIndex(
      (sql) =>
        sql.includes("do_thing") &&
        sql.includes("a int)") &&
        !sql.includes("b text"),
    );
    const fn2Index = orderedSql.findIndex(
      (sql) => sql.includes("do_thing") && sql.includes("b text"),
    );
    const viewIndex = orderedSql.findIndex((sql) =>
      sql.includes("create view app.processed"),
    );

    expect(fn1Index).toBeGreaterThan(-1);
    expect(fn2Index).toBeGreaterThan(-1);
    expect(viewIndex).toBeGreaterThan(fn1Index);
    expect(viewIndex).toBeGreaterThan(fn2Index);
  });

  test("resolves overloads from explicit casted call-site signatures", async () => {
    const result = await analyzeAndSort([
      "create schema app;",
      "create function app.normalize(value text) returns text language sql as $$ select lower(value) $$;",
      "create function app.normalize(value jsonb) returns text language sql as $$ select value::text $$;",
      "create table app.events(payload jsonb not null);",
      "create view app.normalized_payload as select app.normalize(payload::jsonb) as normalized from app.events;",
    ]);
    const ambiguousDiagnostics = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "DUPLICATE_PRODUCER" &&
        diagnostic.message.includes("Ambiguous compatible producers"),
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const jsonbFunctionIndex = orderedSql.findIndex(
      (sql) => sql.includes("normalize") && sql.includes("jsonb"),
    );
    const viewIndex = orderedSql.findIndex((sql) =>
      sql.includes("create view app.normalized_payload"),
    );

    expect(ambiguousDiagnostics).toHaveLength(0);
    expect(jsonbFunctionIndex).toBeGreaterThan(-1);
    expect(viewIndex).toBeGreaterThan(jsonbFunctionIndex);
  });

  test("pg-topo:requires annotation supersedes ambiguous body-extracted requirement", async () => {
    // When an annotation provides a concrete signature, the body-extracted
    // (unknown,unknown) ref for the same function should be suppressed,
    // avoiding false-positive cycle detection on overloaded functions.
    const result = await analyzeAndSort([
      "create schema app;",
      "create table app.items(id int);",
      "create function app.do_work(a int, b uuid) returns void language sql as $$ select null $$;",
      "create function app.do_work(a text, b uuid) returns void language sql as $$ select null $$;",
      // Annotation pins the dependency to the (int,uuid) overload.
      // Without annotation, the body call `app.do_work(...)` extracts as
      // (unknown,unknown) which matches both overloads and could trigger cycles.
      "-- pg-topo:requires function:app.do_work(int,uuid)\ncreate function app.caller() returns void language sql as $$ select app.do_work(1, gen_random_uuid()) $$;",
    ]);

    const cycleSkipped = result.diagnostics.filter(
      (d) => d.code === "CYCLE_EDGE_SKIPPED",
    );
    const unresolved = result.diagnostics.filter(
      (d) => d.code === "UNRESOLVED_DEPENDENCY",
    );
    expect(cycleSkipped).toHaveLength(0);
    expect(unresolved).toHaveLength(0);

    const orderedSql = result.ordered.map((s) => s.sql.toLowerCase());
    const targetFnIndex = orderedSql.findIndex(
      (sql) => sql.includes("do_work") && sql.includes("a int"),
    );
    const callerIndex = orderedSql.findIndex((sql) =>
      sql.includes("app.caller"),
    );
    expect(targetFnIndex).toBeGreaterThan(-1);
    expect(callerIndex).toBeGreaterThan(targetFnIndex);
  });

  test("skips cycle-creating edge from compatible overload and emits diagnostic", async () => {
    // Scenario: two overloads of app.process match a call with 1 arg via
    // prefix matching. One overload's body references the view (creating a
    // reverse dependency). Without cycle prevention, adding edges to BOTH
    // overloads would form a cycle and drop both from the ordered output.
    const result = await analyzeAndSort([
      "create schema app;",
      "create table app.items(val int);",
      // Overload 1: simple, no dependency on the view
      "create function app.process(a int) returns int language sql as $$ select a $$;",
      // Overload 2: its body selects from the view, creating view -> fn2 dependency
      "create function app.process(a int, b text default 'x') returns int language sql as $$ select val from app.summary limit 1 $$;",
      // View calls app.process(val) -- matches both overloads via prefix
      "create view app.summary as select app.process(val) as result from app.items;",
    ]);

    const cycleDetected = result.diagnostics.filter(
      (d) => d.code === "CYCLE_DETECTED",
    );
    const orderedSql = result.ordered.map((s) => s.sql.toLowerCase());
    const viewIndex = orderedSql.findIndex((sql) =>
      sql.includes("create view app.summary"),
    );

    expect(cycleDetected).toHaveLength(0);
    expect(viewIndex).toBeGreaterThan(-1);

    const skippedEdgeDiag = result.diagnostics.filter(
      (d) => d.code === "CYCLE_EDGE_SKIPPED",
    );
    expect(skippedEdgeDiag.length).toBeGreaterThanOrEqual(1);

    const diag = skippedEdgeDiag[0];
    expect(diag).toBeDefined();
    expect(diag?.message).toContain("would create a cycle");
    expect(diag?.message).toContain("app.process");
    expect(diag?.suggestedFix).toBeDefined();
    expect(diag?.suggestedFix).toContain("pg-topo:requires");
    expect(diag?.details).toBeDefined();
    expect(diag?.details?.producerStatementId).toBeDefined();
    expect(diag?.details?.producerProvides).toBeDefined();
    expect(diag?.details?.consumerRequires).toBeDefined();
  });
});
