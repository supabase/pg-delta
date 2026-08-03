import { describe, expect, test } from "bun:test";
import { analyzeAndSort } from "../src/analyze-and-sort";
import { validateAnalyzeResultWithPostgres } from "./support/postgres-validation";

describe("analyzeAndSort", () => {
  test("orders table before dependent view deterministically", async () => {
    const result = await analyzeAndSort([
      "create view public.user_emails as select email from public.users;",
      "create table public.users(id int primary key, email text not null);",
    ]);
    const orderedClasses = result.ordered.map(
      (statement) => statement.statementClass,
    );

    expect(orderedClasses).toEqual(["CREATE_TABLE", "CREATE_VIEW"]);
    expect(
      result.diagnostics.filter(
        (diagnostic) => diagnostic.code === "CYCLE_DETECTED",
      ),
    ).toHaveLength(0);
  });

  test("statically orders SQL functions by body dependencies", async () => {
    const result = await analyzeAndSort([
      "create function public.fn_a() returns int language sql as $$ select public.fn_b() $$;",
      "create function public.fn_b() returns int language sql as $$ select 1 $$;",
    ]);
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );

    expect(orderedSql[0]).toContain("fn_b");
    expect(orderedSql[1]).toContain("fn_a");
  });

  test("statically orders PLpgSQL functions by qualified body dependencies", async () => {
    const result = await analyzeAndSort([
      "create function public.fn_a() returns int language plpgsql as $$ begin return public.fn_b(); end; $$;",
      "create function public.fn_b() returns int language sql as $$ select 1 $$;",
    ]);
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const hasUnknownClass = result.diagnostics.some(
      (diagnostic) => diagnostic.code === "UNKNOWN_STATEMENT_CLASS",
    );

    expect(orderedSql[0]).toContain("fn_b");
    expect(orderedSql[1]).toContain("fn_a");
    expect(hasUnknownClass).toBe(false);
  });

  test("returns stable order across repeated runs", async () => {
    const sql = [
      "create schema app;",
      "create table app.accounts(id int primary key);",
      "create view app.account_ids as select id from app.accounts;",
    ];

    const first = await analyzeAndSort(sql);
    const second = await analyzeAndSort(sql);

    const firstIds = first.ordered.map(
      (statement) => `${statement.id.filePath}:${statement.id.statementIndex}`,
    );
    const secondIds = second.ordered.map(
      (statement) => `${statement.id.filePath}:${statement.id.statementIndex}`,
    );
    expect(firstIds).toEqual(secondIds);
  });

  test("orders domain with CHECK function call after the referenced function", async () => {
    const result = await analyzeAndSort([
      "create domain app.semver as app.semver_struct check (app.is_valid(VALUE));",
      "create type app.semver_struct as (major smallint, minor smallint, patch smallint);",
      "create function app.is_valid(app.semver_struct) returns boolean language sql immutable as $$ select ($1).major is not null $$;",
      "create schema app;",
    ]);
    const orderedClasses = result.ordered.map(
      (statement) => statement.statementClass,
    );

    expect(orderedClasses).toEqual([
      "CREATE_SCHEMA",
      "CREATE_TYPE",
      "CREATE_FUNCTION",
      "CREATE_DOMAIN",
    ]);
    expect(
      result.diagnostics.filter(
        (diagnostic) => diagnostic.code === "CYCLE_DETECTED",
      ),
    ).toHaveLength(0);
  });

  test("orders ALTER PUBLICATION ADD TABLE after referenced publication and table", async () => {
    const result = await analyzeAndSort([
      "alter publication pub_orders add table public.orders;",
      "create table public.orders(id int primary key);",
      "create publication pub_orders;",
    ]);
    const orderedClasses = result.ordered.map(
      (statement) => statement.statementClass,
    );
    const hasUnknownClass = result.diagnostics.some(
      (diagnostic) => diagnostic.code === "UNKNOWN_STATEMENT_CLASS",
    );

    expect(orderedClasses).toEqual([
      "CREATE_TABLE",
      "CREATE_PUBLICATION",
      "ALTER_PUBLICATION",
    ]);
    expect(hasUnknownClass).toBe(false);
    const validation = await validateAnalyzeResultWithPostgres(result);
    expect(validation.diagnostics).toHaveLength(0);
  }, 120000);

  test("orders ALTER PUBLICATION SET TABLES IN SCHEMA after referenced publication and schema", async () => {
    const result = await analyzeAndSort([
      "alter publication pub_sales set tables in schema sales;",
      "create publication pub_sales;",
      "create schema sales;",
    ]);
    const orderedClasses = result.ordered.map(
      (statement) => statement.statementClass,
    );
    const hasUnknownClass = result.diagnostics.some(
      (diagnostic) => diagnostic.code === "UNKNOWN_STATEMENT_CLASS",
    );

    expect(orderedClasses).toEqual([
      "CREATE_SCHEMA",
      "CREATE_PUBLICATION",
      "ALTER_PUBLICATION",
    ]);
    expect(hasUnknownClass).toBe(false);
  });

  test("orders ALTER PUBLICATION DROP TABLE after referenced publication and table", async () => {
    const result = await analyzeAndSort([
      "alter publication pub_orders drop table public.orders;",
      "create publication pub_orders;",
      "create table public.orders(id int primary key);",
    ]);
    const orderedClasses = result.ordered.map(
      (statement) => statement.statementClass,
    );
    const hasUnknownClass = result.diagnostics.some(
      (diagnostic) => diagnostic.code === "UNKNOWN_STATEMENT_CLASS",
    );

    expect(orderedClasses).toEqual([
      "CREATE_TABLE",
      "CREATE_PUBLICATION",
      "ALTER_PUBLICATION",
    ]);
    expect(
      result.graph.edges.some(
        (edge) =>
          edge.reason === "requires" &&
          edge.objectRef?.kind === "table" &&
          edge.objectRef.schema === "public" &&
          edge.objectRef.name === "orders",
      ),
    ).toBe(true);
    expect(hasUnknownClass).toBe(false);
  });

  test("orders ALTER PUBLICATION DROP TABLES IN SCHEMA after referenced publication and schema", async () => {
    const result = await analyzeAndSort([
      "alter publication pub_sales drop tables in schema sales;",
      "create publication pub_sales;",
      "create schema sales;",
    ]);
    const orderedClasses = result.ordered.map(
      (statement) => statement.statementClass,
    );
    const hasUnknownClass = result.diagnostics.some(
      (diagnostic) => diagnostic.code === "UNKNOWN_STATEMENT_CLASS",
    );

    expect(orderedClasses).toEqual([
      "CREATE_SCHEMA",
      "CREATE_PUBLICATION",
      "ALTER_PUBLICATION",
    ]);
    expect(
      result.graph.edges.some(
        (edge) =>
          edge.reason === "requires" &&
          edge.objectRef?.kind === "schema" &&
          edge.objectRef.name === "sales",
      ),
    ).toBe(true);
    expect(hasUnknownClass).toBe(false);
  });

  test("orders ALTER SUBSCRIPTION SET PUBLICATION after referenced subscription and publications", async () => {
    const result = await analyzeAndSort([
      "alter subscription sub_orders set publication pub_events;",
      "create publication pub_events;",
      "create subscription sub_orders connection 'host=localhost port=5432 dbname=postgres' publication pub_orders with (connect = false);",
      "create publication pub_orders;",
    ]);
    const orderedClasses = result.ordered.map(
      (statement) => statement.statementClass,
    );
    const hasUnknownClass = result.diagnostics.some(
      (diagnostic) => diagnostic.code === "UNKNOWN_STATEMENT_CLASS",
    );

    expect(orderedClasses).toEqual([
      "CREATE_PUBLICATION",
      "CREATE_PUBLICATION",
      "CREATE_SUBSCRIPTION",
      "ALTER_SUBSCRIPTION",
    ]);
    expect(result.ordered[0]?.sql.toLowerCase()).toContain("pub_events");
    expect(result.ordered[1]?.sql.toLowerCase()).toContain("pub_orders");
    expect(hasUnknownClass).toBe(false);
  });

  test("orders ALTER SUBSCRIPTION ADD PUBLICATION after referenced subscription and publications", async () => {
    const result = await analyzeAndSort([
      "alter subscription sub_orders add publication pub_events;",
      "create subscription sub_orders connection 'host=localhost port=5432 dbname=postgres' publication pub_orders with (connect = false);",
      "create publication pub_orders;",
      "create publication pub_events;",
    ]);
    const orderedClasses = result.ordered.map(
      (statement) => statement.statementClass,
    );
    const hasUnknownClass = result.diagnostics.some(
      (diagnostic) => diagnostic.code === "UNKNOWN_STATEMENT_CLASS",
    );

    expect(orderedClasses).toEqual([
      "CREATE_PUBLICATION",
      "CREATE_PUBLICATION",
      "CREATE_SUBSCRIPTION",
      "ALTER_SUBSCRIPTION",
    ]);
    expect(result.ordered[0]?.sql.toLowerCase()).toContain("pub_orders");
    expect(result.ordered[1]?.sql.toLowerCase()).toContain("pub_events");
    expect(
      result.graph.edges.some(
        (edge) =>
          edge.reason === "requires" &&
          edge.objectRef.kind === "publication" &&
          edge.objectRef.name === "pub_events",
      ),
    ).toBe(true);
    expect(hasUnknownClass).toBe(false);
  });

  test("statement ids include sourceOffset when parser provides location", async () => {
    const result = await analyzeAndSort([
      "create table public.t1(id int);",
      "create table public.t2(id int);",
    ]);
    expect(result.ordered.length).toBeGreaterThanOrEqual(1);
    const first = result.ordered[0];
    expect(first?.id).toBeDefined();
    expect(typeof first?.id.sourceOffset).toBe("number");
  });

  test("ordered is a total order: cycle members are kept, not dropped", async () => {
    // Two views referencing each other form a dependency cycle. Kahn's
    // algorithm can drain neither, but `ordered` must still be a complete
    // permutation of the input — downstream consumers such as pg-delta's
    // declarative-apply engine feed `ordered` into a defer-and-retry loader and
    // must receive every statement exactly once.
    const result = await analyzeAndSort([
      "create view public.v1 as select * from public.v2;",
      "create view public.v2 as select * from public.v1;",
    ]);

    // The cycle is still reported.
    expect(
      result.diagnostics.filter(
        (diagnostic) => diagnostic.code === "CYCLE_DETECTED",
      ).length,
    ).toBeGreaterThan(0);
    expect(result.graph.cycleGroups.length).toBeGreaterThan(0);

    // But no statement is dropped from the output.
    expect(result.ordered.length).toBe(2);
    const orderedKeys = result.ordered
      .map((statement) => statement.sql.toLowerCase())
      .sort();
    expect(orderedKeys).toEqual([
      "create view public.v1 as select * from public.v2;",
      "create view public.v2 as select * from public.v1;",
    ]);

    // Determinism: the same input yields the same ordered IDs.
    const again = await analyzeAndSort([
      "create view public.v1 as select * from public.v2;",
      "create view public.v2 as select * from public.v1;",
    ]);
    expect(
      again.ordered.map(
        (statement) =>
          `${statement.id.filePath}:${statement.id.statementIndex}`,
      ),
    ).toEqual(
      result.ordered.map(
        (statement) =>
          `${statement.id.filePath}:${statement.id.statementIndex}`,
      ),
    );
  });

  test("keeps a cyclic component before its downstream consumer", async () => {
    const sql = [
      "create view public.v_downstream as select * from public.v1;",
      "create view public.v1 as select * from public.v2;",
      "create view public.v2 as select * from public.v1;",
    ];

    const result = await analyzeAndSort(sql);
    const orderedIds = result.ordered.map(
      (statement) => `${statement.id.filePath}:${statement.id.statementIndex}`,
    );

    expect(result.ordered).toHaveLength(3);
    expect(new Set(orderedIds).size).toBe(3);
    expect(result.graph.cycleGroups).toEqual([
      [
        { filePath: "<input:1>", statementIndex: 0, sourceOffset: 0 },
        { filePath: "<input:2>", statementIndex: 0, sourceOffset: 0 },
      ],
    ]);

    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const downstreamIndex = orderedSql.findIndex((statement) =>
      statement.includes("v_downstream"),
    );
    expect(
      orderedSql.findIndex((statement) => statement.includes("view public.v1")),
    ).toBeLessThan(downstreamIndex);
    expect(
      orderedSql.findIndex((statement) => statement.includes("view public.v2")),
    ).toBeLessThan(downstreamIndex);

    const again = await analyzeAndSort(sql);
    expect(
      again.ordered.map(
        (statement) =>
          `${statement.id.filePath}:${statement.id.statementIndex}`,
      ),
    ).toEqual(orderedIds);
  });
});
