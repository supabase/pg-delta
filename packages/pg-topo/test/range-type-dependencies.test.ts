import { describe, expect, test } from "bun:test";
import { analyzeAndSort } from "../src/analyze-and-sort";
import { validateAnalyzeResultWithPostgres } from "./support/postgres-validation";

describe("range type dependencies", () => {
  test("orders executable range type dependencies", async () => {
    const result = await analyzeAndSort([
      "create table app.events(id int primary key, during app.int_range not null);",
      "create type app.int_range as range (subtype = int4, subtype_diff = app.int4_subdiff);",
      "create function app.int4_subdiff(a int4, b int4) returns float8 language sql immutable as $$ select (a - b)::float8 $$;",
      "create schema app;",
    ]);
    const validation = await validateAnalyzeResultWithPostgres(result);
    const unknownCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNKNOWN_STATEMENT_CLASS",
    ).length;
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const schemaIndex = orderedSql.findIndex((sql) =>
      sql.includes("create schema app"),
    );
    const subtypeDiffIndex = orderedSql.findIndex((sql) =>
      sql.includes("create function app.int4_subdiff"),
    );
    const rangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.int_range"),
    );
    const tableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table app.events"),
    );

    expect(unknownCount).toBe(0);
    expect(unresolvedCount).toBe(0);
    expect(executionErrors).toHaveLength(0);
    expect(schemaIndex).toBeGreaterThanOrEqual(0);
    expect(subtypeDiffIndex).toBeGreaterThan(schemaIndex);
    expect(rangeIndex).toBeGreaterThan(subtypeDiffIndex);
    expect(tableIndex).toBeGreaterThan(rangeIndex);
  }, 120000);

  test("does not require producer statements for built-in range support functions", async () => {
    const result = await analyzeAndSort([
      "create table app.measurements(id int primary key, value_span app.floatrange not null);",
      "create type app.floatrange as range (subtype = float8, subtype_diff = float8mi);",
      "create schema app;",
    ]);
    const validation = await validateAnalyzeResultWithPostgres(result);
    const unknownCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNKNOWN_STATEMENT_CLASS",
    ).length;
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const schemaIndex = orderedSql.findIndex((sql) =>
      sql.includes("create schema app"),
    );
    const rangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.floatrange"),
    );
    const tableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table app.measurements"),
    );

    expect(unknownCount).toBe(0);
    expect(unresolvedCount).toBe(0);
    expect(executionErrors).toHaveLength(0);
    expect(schemaIndex).toBeGreaterThanOrEqual(0);
    expect(rangeIndex).toBeGreaterThan(schemaIndex);
    expect(tableIndex).toBeGreaterThan(rangeIndex);
  }, 120000);

  test("matches unqualified built-in range support function providers for pg_catalog subtypes", async () => {
    const result = await analyzeAndSort([
      "create type app.int_range as range (subtype = pg_catalog.int4, subtype_diff = app.int4_subdiff);",
      "create function app.int4_subdiff(a int4, b int4) returns float8 language sql immutable as $$ select (a - b)::float8 $$;",
      "create schema app;",
    ]);
    const unresolvedSubtypeDiff = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.schema === "app" &&
            ref.name === "int4_subdiff",
        ) === true,
    );

    expect(unresolvedSubtypeDiff).toHaveLength(0);
  });

  test("preserves local float8mi subtype_diff functions", async () => {
    const result = await analyzeAndSort([
      "set search_path = public, pg_catalog;",
      "create table measurements(id int primary key, value_span floatrange not null);",
      "create type floatrange as range (subtype = float8, subtype_diff = float8mi);",
      "create function float8mi(a float8, b float8) returns float8 language sql immutable strict as $$ select (a - b) * 2 $$;",
    ]);
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const rangeStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create type floatrange"),
    );

    expect(unresolvedCount).toBe(0);
    expect(rangeStatement?.requires).toContainEqual({
      kind: "function",
      schema: "public",
      name: "float8mi",
      signature: "(pg_catalog.float8,pg_catalog.float8)->float8",
    });

    const validation = await validateAnalyzeResultWithPostgres(result);
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const subtypeDiffIndex = orderedSql.findIndex((sql) =>
      sql.includes("create function float8mi"),
    );
    const rangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type floatrange"),
    );
    const tableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table measurements"),
    );

    expect(executionErrors).toHaveLength(0);
    expect(subtypeDiffIndex).toBeGreaterThanOrEqual(0);
    expect(rangeIndex).toBeGreaterThan(subtypeDiffIndex);
    expect(tableIndex).toBeGreaterThan(rangeIndex);
  }, 120000);

  test("does not require producer statements for built-in subtype_diff helpers", async () => {
    const result = await analyzeAndSort([
      "create table app.measurements(id int primary key, value_span app.int4_range not null);",
      "create type app.int4_range as range (subtype = int4, subtype_diff = int4range_subdiff);",
      "create schema app;",
    ]);
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const rangeStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create type app.int4_range"),
    );

    expect(unresolvedCount).toBe(0);
    expect(rangeStatement?.requires).not.toContainEqual({
      kind: "function",
      schema: "public",
      name: "int4range_subdiff",
      signature: "(int4,int4)",
    });

    const validation = await validateAnalyzeResultWithPostgres(result);
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const schemaIndex = orderedSql.findIndex((sql) =>
      sql.includes("create schema app"),
    );
    const rangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.int4_range"),
    );
    const tableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table app.measurements"),
    );

    expect(executionErrors).toHaveLength(0);
    expect(schemaIndex).toBeGreaterThanOrEqual(0);
    expect(rangeIndex).toBeGreaterThan(schemaIndex);
    expect(tableIndex).toBeGreaterThan(rangeIndex);
  }, 120000);

  test("orders range type after custom collation", async () => {
    const result = await analyzeAndSort([
      "create table app.labels(id int primary key, value_span app.label_range not null);",
      "create type app.label_range as range (subtype = text, collation = app.default_ci);",
      'create collation app.default_ci from "C";',
      "create schema app;",
    ]);
    const validation = await validateAnalyzeResultWithPostgres(result);
    const unknownCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNKNOWN_STATEMENT_CLASS",
    ).length;
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const schemaIndex = orderedSql.findIndex((sql) =>
      sql.includes("create schema app"),
    );
    const collationIndex = orderedSql.findIndex((sql) =>
      sql.includes("create collation app.default_ci"),
    );
    const rangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.label_range"),
    );
    const tableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table app.labels"),
    );

    expect(unknownCount).toBe(0);
    expect(unresolvedCount).toBe(0);
    expect(executionErrors).toHaveLength(0);
    expect(schemaIndex).toBeGreaterThanOrEqual(0);
    expect(collationIndex).toBeGreaterThan(schemaIndex);
    expect(rangeIndex).toBeGreaterThan(collationIndex);
    expect(tableIndex).toBeGreaterThan(rangeIndex);
  }, 120000);

  test("orders range type after custom operator class", async () => {
    const result = await analyzeAndSort([
      "create table app.measurements(id int primary key, value_span app.custom_int4_range not null);",
      "create type app.custom_int4_range as range (subtype = int4, subtype_opclass = app.int4_range_ops);",
      "create operator class app.int4_range_ops for type int4 using btree as operator 1 < (int4, int4), operator 2 <= (int4, int4), operator 3 = (int4, int4), operator 4 >= (int4, int4), operator 5 > (int4, int4), function 1 btint4cmp(int4, int4);",
      "create schema app;",
    ]);
    const validation = await validateAnalyzeResultWithPostgres(result);
    const unknownCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNKNOWN_STATEMENT_CLASS",
    ).length;
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const schemaIndex = orderedSql.findIndex((sql) =>
      sql.includes("create schema app"),
    );
    const operatorClassIndex = orderedSql.findIndex((sql) =>
      sql.includes("create operator class app.int4_range_ops"),
    );
    const rangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.custom_int4_range"),
    );
    const tableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table app.measurements"),
    );

    expect(unknownCount).toBe(0);
    expect(unresolvedCount).toBe(0);
    expect(executionErrors).toHaveLength(0);
    expect(schemaIndex).toBeGreaterThanOrEqual(0);
    expect(operatorClassIndex).toBeGreaterThan(schemaIndex);
    expect(rangeIndex).toBeGreaterThan(operatorClassIndex);
    expect(tableIndex).toBeGreaterThan(rangeIndex);
  }, 120000);

  test("orders custom operator classes after support functions", async () => {
    const result = await analyzeAndSort([
      "create table app.measurements(id int primary key, value_span app.custom_int4_range not null);",
      "create type app.custom_int4_range as range (subtype = int4, subtype_opclass = app.int4_range_ops);",
      "create operator class app.int4_range_ops for type int4 using btree as operator 1 < (int4, int4), operator 2 <= (int4, int4), operator 3 = (int4, int4), operator 4 >= (int4, int4), operator 5 > (int4, int4), function 1 app.int4_range_cmp(int4, int4);",
      "create function app.int4_range_cmp(a int4, b int4) returns int4 language sql immutable strict as $$ select a - b $$;",
      "create schema app;",
    ]);
    const validation = await validateAnalyzeResultWithPostgres(result);
    const unknownCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNKNOWN_STATEMENT_CLASS",
    ).length;
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const schemaIndex = orderedSql.findIndex((sql) =>
      sql.includes("create schema app"),
    );
    const supportFunctionIndex = orderedSql.findIndex((sql) =>
      sql.includes("create function app.int4_range_cmp"),
    );
    const operatorClassIndex = orderedSql.findIndex((sql) =>
      sql.includes("create operator class app.int4_range_ops"),
    );
    const rangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.custom_int4_range"),
    );
    const tableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table app.measurements"),
    );

    expect(unknownCount).toBe(0);
    expect(unresolvedCount).toBe(0);
    expect(executionErrors).toHaveLength(0);
    expect(schemaIndex).toBeGreaterThanOrEqual(0);
    expect(supportFunctionIndex).toBeGreaterThan(schemaIndex);
    expect(operatorClassIndex).toBeGreaterThan(supportFunctionIndex);
    expect(rangeIndex).toBeGreaterThan(operatorClassIndex);
    expect(tableIndex).toBeGreaterThan(rangeIndex);
  }, 120000);

  test("targets btree operator classes when access methods share a class name", async () => {
    const result = await analyzeAndSort([
      "create table app.measurements(id int primary key, value_span app.custom_int4_range not null);",
      "create type app.custom_int4_range as range (subtype = int4, subtype_opclass = app.shared_int4_ops);",
      "create operator class app.shared_int4_ops for type int4 using hash as operator 1 = (int4, int4), function 1 hashint4(int4);",
      "create operator class app.shared_int4_ops for type int4 using btree as operator 1 < (int4, int4), operator 2 <= (int4, int4), operator 3 = (int4, int4), operator 4 >= (int4, int4), operator 5 > (int4, int4), function 1 btint4cmp(int4, int4);",
      "create schema app;",
    ]);
    const duplicateCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "DUPLICATE_PRODUCER",
    ).length;
    const rangeStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create type app.custom_int4_range"),
    );

    expect(duplicateCount).toBe(0);
    expect(rangeStatement?.requires).toContainEqual({
      kind: "operator_class",
      schema: "app",
      name: "shared_int4_ops",
      signature: "(btree,int4)",
    });

    const validation = await validateAnalyzeResultWithPostgres(result);
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const schemaIndex = orderedSql.findIndex((sql) =>
      sql.includes("create schema app"),
    );
    const hashOperatorClassIndex = orderedSql.findIndex(
      (sql) =>
        sql.includes("create operator class app.shared_int4_ops") &&
        sql.includes("using hash"),
    );
    const btreeOperatorClassIndex = orderedSql.findIndex(
      (sql) =>
        sql.includes("create operator class app.shared_int4_ops") &&
        sql.includes("using btree"),
    );
    const rangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.custom_int4_range"),
    );
    const tableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table app.measurements"),
    );

    expect(executionErrors).toHaveLength(0);
    expect(schemaIndex).toBeGreaterThanOrEqual(0);
    expect(hashOperatorClassIndex).toBeGreaterThan(schemaIndex);
    expect(btreeOperatorClassIndex).toBeGreaterThan(schemaIndex);
    expect(rangeIndex).toBeGreaterThan(btreeOperatorClassIndex);
    expect(tableIndex).toBeGreaterThan(rangeIndex);
  }, 120000);

  test("orders custom operator classes after conventional support operators for custom types", async () => {
    const result = await analyzeAndSort([
      "create table app.measurements(id int primary key, value_span app.score_range not null);",
      "create type app.score_range as range (subtype = app.score, subtype_opclass = app.score_ops);",
      "create operator class app.score_ops for type app.score using btree as operator 1 < (app.score, app.score), operator 2 <= (app.score, app.score), operator 3 = (app.score, app.score), operator 4 >= (app.score, app.score), operator 5 > (app.score, app.score), function 1 app.score_cmp(app.score, app.score);",
      "create operator > (function = app.score_gt, leftarg = app.score, rightarg = app.score);",
      "create operator >= (function = app.score_gte, leftarg = app.score, rightarg = app.score);",
      "create operator = (function = app.score_eq, leftarg = app.score, rightarg = app.score);",
      "create operator <= (function = app.score_lte, leftarg = app.score, rightarg = app.score);",
      "create operator < (function = app.score_lt, leftarg = app.score, rightarg = app.score);",
      "create function app.score_cmp(a app.score, b app.score) returns int4 language sql immutable strict as $$ select case when (a).value < (b).value then -1 when (a).value > (b).value then 1 else 0 end $$;",
      "create function app.score_gt(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value > (b).value $$;",
      "create function app.score_gte(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value >= (b).value $$;",
      "create function app.score_eq(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value = (b).value $$;",
      "create function app.score_lte(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value <= (b).value $$;",
      "create function app.score_lt(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value < (b).value $$;",
      "create type app.score as (value int4);",
      "create schema app;",
    ]);
    const validation = await validateAnalyzeResultWithPostgres(result);
    const unknownCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNKNOWN_STATEMENT_CLASS",
    ).length;
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const schemaIndex = orderedSql.findIndex((sql) =>
      sql.includes("create schema app"),
    );
    const typeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.score as"),
    );
    const firstFunctionIndex = orderedSql.findIndex((sql) =>
      sql.includes("create function app.score_lt"),
    );
    const lastFunctionIndex = orderedSql.findIndex((sql) =>
      sql.includes("create function app.score_gt"),
    );
    const firstOperatorIndex = orderedSql.findIndex((sql) =>
      sql.includes("create operator <"),
    );
    const lastOperatorIndex = orderedSql.findIndex((sql) =>
      sql.includes("create operator >"),
    );
    const operatorClassIndex = orderedSql.findIndex((sql) =>
      sql.includes("create operator class app.score_ops"),
    );
    const rangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.score_range"),
    );
    const tableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table app.measurements"),
    );

    expect(unknownCount).toBe(0);
    expect(unresolvedCount).toBe(0);
    expect(executionErrors).toHaveLength(0);
    expect(schemaIndex).toBeGreaterThanOrEqual(0);
    expect(typeIndex).toBeGreaterThan(schemaIndex);
    expect(firstFunctionIndex).toBeGreaterThan(typeIndex);
    expect(lastFunctionIndex).toBeGreaterThan(typeIndex);
    expect(firstOperatorIndex).toBeGreaterThan(firstFunctionIndex);
    expect(firstOperatorIndex).toBeGreaterThan(lastFunctionIndex);
    expect(lastOperatorIndex).toBeGreaterThan(firstFunctionIndex);
    expect(lastOperatorIndex).toBeGreaterThan(lastFunctionIndex);
    expect(operatorClassIndex).toBeGreaterThan(firstOperatorIndex);
    expect(operatorClassIndex).toBeGreaterThan(lastOperatorIndex);
    expect(rangeIndex).toBeGreaterThan(operatorClassIndex);
    expect(tableIndex).toBeGreaterThan(rangeIndex);
  }, 120000);

  test("orders omitted range subtype defaults through domain base opclasses", async () => {
    const result = await analyzeAndSort([
      "create table app.measurements(id int primary key, value_span app.score_range not null);",
      "create type app.score_range as range (subtype = app.score_domain);",
      "create domain app.score_domain as app.score;",
      "create operator class app.score_ops default for type app.score using btree as operator 1 app.< (app.score, app.score), operator 2 app.<= (app.score, app.score), operator 3 app.= (app.score, app.score), operator 4 app.>= (app.score, app.score), operator 5 app.> (app.score, app.score), function 1 app.score_cmp(app.score, app.score);",
      "create operator app.> (function = app.score_gt, leftarg = app.score, rightarg = app.score);",
      "create operator app.>= (function = app.score_gte, leftarg = app.score, rightarg = app.score);",
      "create operator app.= (function = app.score_eq, leftarg = app.score, rightarg = app.score);",
      "create operator app.<= (function = app.score_lte, leftarg = app.score, rightarg = app.score);",
      "create operator app.< (function = app.score_lt, leftarg = app.score, rightarg = app.score);",
      "create function app.score_cmp(a app.score, b app.score) returns int4 language sql immutable strict as $$ select case when (a).value < (b).value then -1 when (a).value > (b).value then 1 else 0 end $$;",
      "create function app.score_gt(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value > (b).value $$;",
      "create function app.score_gte(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value >= (b).value $$;",
      "create function app.score_eq(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value = (b).value $$;",
      "create function app.score_lte(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value <= (b).value $$;",
      "create function app.score_lt(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value < (b).value $$;",
      "create type app.score as (value int4);",
      "create schema app;",
    ]);
    const validation = await validateAnalyzeResultWithPostgres(result);
    const missingDefault = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.message.includes("No default btree operator class provider"),
    );
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const opclassIndex = orderedSql.findIndex((sql) =>
      sql.includes("create operator class app.score_ops"),
    );
    const domainIndex = orderedSql.findIndex((sql) =>
      sql.includes("create domain app.score_domain"),
    );
    const rangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.score_range"),
    );

    expect(missingDefault).toHaveLength(0);
    expect(executionErrors).toHaveLength(0);
    expect(opclassIndex).toBeGreaterThanOrEqual(0);
    expect(domainIndex).toBeGreaterThanOrEqual(0);
    expect(rangeIndex).toBeGreaterThan(opclassIndex);
    expect(rangeIndex).toBeGreaterThan(domainIndex);
  }, 120000);

  test("orders custom operator classes after conventional support function names with custom types", async () => {
    const result = await analyzeAndSort([
      "create table app.measurements(id int primary key, value_span app.score_range not null);",
      "create type app.score_range as range (subtype = app.score, subtype_opclass = app.score_ops);",
      "create operator class app.score_ops for type app.score using btree as operator 1 < (app.score, app.score), operator 2 <= (app.score, app.score), operator 3 = (app.score, app.score), operator 4 >= (app.score, app.score), operator 5 > (app.score, app.score), function 1 btint4cmp(app.score, app.score);",
      "create function btint4cmp(a app.score, b app.score) returns int4 language sql immutable strict as $$ select case when (a).value < (b).value then -1 when (a).value > (b).value then 1 else 0 end $$;",
      "create operator > (function = app.score_gt, leftarg = app.score, rightarg = app.score);",
      "create operator >= (function = app.score_gte, leftarg = app.score, rightarg = app.score);",
      "create operator = (function = app.score_eq, leftarg = app.score, rightarg = app.score);",
      "create operator <= (function = app.score_lte, leftarg = app.score, rightarg = app.score);",
      "create operator < (function = app.score_lt, leftarg = app.score, rightarg = app.score);",
      "create function app.score_gt(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value > (b).value $$;",
      "create function app.score_gte(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value >= (b).value $$;",
      "create function app.score_eq(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value = (b).value $$;",
      "create function app.score_lte(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value <= (b).value $$;",
      "create function app.score_lt(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value < (b).value $$;",
      "create type app.score as (value int4);",
      "create schema app;",
    ]);
    const validation = await validateAnalyzeResultWithPostgres(result);
    const unknownCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNKNOWN_STATEMENT_CLASS",
    ).length;
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const operatorClassStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator class app.score_ops"),
    );
    const typeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.score as"),
    );
    const supportFunctionIndex = orderedSql.findIndex((sql) =>
      sql.includes("create function btint4cmp"),
    );
    const firstOperatorIndex = orderedSql.findIndex((sql) =>
      sql.includes("create operator <"),
    );
    const lastOperatorIndex = orderedSql.findIndex((sql) =>
      sql.includes("create operator >"),
    );
    const operatorClassIndex = orderedSql.findIndex((sql) =>
      sql.includes("create operator class app.score_ops"),
    );
    const rangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.score_range"),
    );
    const tableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table app.measurements"),
    );

    expect(unknownCount).toBe(0);
    expect(unresolvedCount).toBe(0);
    expect(executionErrors).toHaveLength(0);
    expect(operatorClassStatement?.requires).toContainEqual({
      kind: "function",
      schema: "public",
      name: "btint4cmp",
      signature: "(app.score,app.score)->int4",
    });
    expect(typeIndex).toBeGreaterThanOrEqual(0);
    expect(supportFunctionIndex).toBeGreaterThan(typeIndex);
    expect(firstOperatorIndex).toBeGreaterThan(supportFunctionIndex);
    expect(lastOperatorIndex).toBeGreaterThan(supportFunctionIndex);
    expect(operatorClassIndex).toBeGreaterThan(firstOperatorIndex);
    expect(operatorClassIndex).toBeGreaterThan(lastOperatorIndex);
    expect(operatorClassIndex).toBeGreaterThan(supportFunctionIndex);
    expect(rangeIndex).toBeGreaterThan(operatorClassIndex);
    expect(tableIndex).toBeGreaterThan(rangeIndex);
  }, 120000);

  test("orders custom operator classes after support operators", async () => {
    const result = await analyzeAndSort([
      "create table app.measurements(id int primary key, value_span app.custom_int4_range not null);",
      "create type app.custom_int4_range as range (subtype = int4, subtype_opclass = app.int4_range_ops);",
      "create operator class app.int4_range_ops for type int4 using btree as operator 1 app.<# (int4, int4), operator 2 app.<=# (int4, int4), operator 3 app.=# (int4, int4), operator 4 app.>=# (int4, int4), operator 5 app.># (int4, int4), function 1 btint4cmp(int4, int4);",
      "create operator app.># (function = app.int4_gt, leftarg = int4, rightarg = int4);",
      "create operator app.>=# (function = app.int4_gte, leftarg = int4, rightarg = int4);",
      "create operator app.=# (function = app.int4_eq, leftarg = int4, rightarg = int4);",
      "create operator app.<=# (function = app.int4_lte, leftarg = int4, rightarg = int4);",
      "create operator app.<# (function = app.int4_lt, leftarg = int4, rightarg = int4);",
      "create function app.int4_gt(a int4, b int4) returns boolean language sql immutable strict as $$ select a > b $$;",
      "create function app.int4_gte(a int4, b int4) returns boolean language sql immutable strict as $$ select a >= b $$;",
      "create function app.int4_eq(a int4, b int4) returns boolean language sql immutable strict as $$ select a = b $$;",
      "create function app.int4_lte(a int4, b int4) returns boolean language sql immutable strict as $$ select a <= b $$;",
      "create function app.int4_lt(a int4, b int4) returns boolean language sql immutable strict as $$ select a < b $$;",
      "create schema app;",
    ]);
    const validation = await validateAnalyzeResultWithPostgres(result);
    const unknownCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNKNOWN_STATEMENT_CLASS",
    ).length;
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const schemaIndex = orderedSql.findIndex((sql) =>
      sql.includes("create schema app"),
    );
    const firstFunctionIndex = orderedSql.findIndex((sql) =>
      sql.includes("create function app.int4_lt"),
    );
    const lastFunctionIndex = orderedSql.findIndex((sql) =>
      sql.includes("create function app.int4_gt"),
    );
    const firstOperatorIndex = orderedSql.findIndex((sql) =>
      sql.includes("create operator app.<#"),
    );
    const lastOperatorIndex = orderedSql.findIndex((sql) =>
      sql.includes("create operator app.>#"),
    );
    const operatorClassIndex = orderedSql.findIndex((sql) =>
      sql.includes("create operator class app.int4_range_ops"),
    );
    const rangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.custom_int4_range"),
    );
    const tableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table app.measurements"),
    );

    expect(unknownCount).toBe(0);
    expect(unresolvedCount).toBe(0);
    expect(executionErrors).toHaveLength(0);
    expect(schemaIndex).toBeGreaterThanOrEqual(0);
    expect(firstFunctionIndex).toBeGreaterThan(schemaIndex);
    expect(lastFunctionIndex).toBeGreaterThan(schemaIndex);
    expect(firstOperatorIndex).toBeGreaterThan(firstFunctionIndex);
    expect(firstOperatorIndex).toBeGreaterThan(lastFunctionIndex);
    expect(lastOperatorIndex).toBeGreaterThan(firstFunctionIndex);
    expect(lastOperatorIndex).toBeGreaterThan(lastFunctionIndex);
    expect(operatorClassIndex).toBeGreaterThan(firstOperatorIndex);
    expect(operatorClassIndex).toBeGreaterThan(lastOperatorIndex);
    expect(rangeIndex).toBeGreaterThan(operatorClassIndex);
    expect(tableIndex).toBeGreaterThan(rangeIndex);
  }, 120000);

  test("records operator estimator functions as operator dependencies", async () => {
    const result = await analyzeAndSort([
      "create operator app.<# (function = app.score_lt, leftarg = app.score, rightarg = app.score, restrict = app.score_sel, join = app.score_join);",
      "create function app.score_join(internal, oid, internal, smallint, internal) returns float8 language internal stable strict as 'eqjoinsel';",
      "create function app.score_sel(internal, oid, internal, integer) returns float8 language internal stable strict as 'eqsel';",
      "create function app.score_lt(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value < (b).value $$;",
      "create type app.score as (value int4);",
      "create schema app;",
    ]);
    const unknownCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNKNOWN_STATEMENT_CLASS",
    ).length;
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const operatorStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create operator app.<#"),
    );

    expect(unknownCount).toBe(0);
    expect(unresolvedCount).toBe(0);
    expect(operatorStatement?.requires).toContainEqual({
      kind: "function",
      schema: "app",
      name: "score_sel",
      signature: "(internal,oid,internal,int4)->float8",
    });
    expect(operatorStatement?.requires).toContainEqual({
      kind: "function",
      schema: "app",
      name: "score_join",
      signature: "(internal,oid,internal,int2,internal)->float8",
    });

    const validation = await validateAnalyzeResultWithPostgres(result);
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const typeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.score as"),
    );
    const operatorFunctionIndex = orderedSql.findIndex((sql) =>
      sql.includes("create function app.score_lt"),
    );
    const restrictFunctionIndex = orderedSql.findIndex((sql) =>
      sql.includes("create function app.score_sel"),
    );
    const joinFunctionIndex = orderedSql.findIndex((sql) =>
      sql.includes("create function app.score_join"),
    );
    const operatorIndex = orderedSql.findIndex((sql) =>
      sql.includes("create operator app.<#"),
    );

    expect(executionErrors).toHaveLength(0);
    expect(typeIndex).toBeGreaterThanOrEqual(0);
    expect(operatorFunctionIndex).toBeGreaterThan(typeIndex);
    expect(restrictFunctionIndex).toBeGreaterThan(typeIndex);
    expect(joinFunctionIndex).toBeGreaterThan(typeIndex);
    expect(operatorIndex).toBeGreaterThan(operatorFunctionIndex);
    expect(operatorIndex).toBeGreaterThan(restrictFunctionIndex);
    expect(operatorIndex).toBeGreaterThan(joinFunctionIndex);
  }, 120000);

  test("requires operator estimator functions with PostgreSQL signatures", async () => {
    const result = await analyzeAndSort([
      "create operator app.<# (function = app.score_lt, leftarg = app.score, rightarg = app.score, restrict = app.score_sel, join = app.score_join);",
      "create function app.score_join(value int4) returns float8 language sql immutable strict as $$ select value::float8 $$;",
      "create function app.score_sel(value int4) returns float8 language sql immutable strict as $$ select value::float8 $$;",
      "create function app.score_lt(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value < (b).value $$;",
      "create type app.score as (value int4);",
      "create schema app;",
    ]);
    const unresolved = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    );
    const operatorStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create operator app.<#"),
    );

    expect(unresolved).toHaveLength(2);
    expect(operatorStatement?.requires).toContainEqual({
      kind: "function",
      schema: "app",
      name: "score_sel",
      signature: "(internal,oid,internal,int4)->float8",
    });
    expect(operatorStatement?.requires).toContainEqual({
      kind: "function",
      schema: "app",
      name: "score_join",
      signature: "(internal,oid,internal,int2,internal)->float8",
    });
  });

  test("requires exact operator estimator signatures", async () => {
    const result = await analyzeAndSort([
      "create operator app.<# (function = app.score_lt, leftarg = app.score, rightarg = app.score, restrict = app.score_sel, join = app.score_join);",
      "create function app.score_join(internal, oid, internal, int2, internal, extra text default '') returns float8 language internal stable strict as 'eqjoinsel';",
      "create function app.score_sel(internal, oid, internal, int4, extra text default '') returns float8 language internal stable strict as 'eqsel';",
      "create function app.score_lt(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value < (b).value $$;",
      "create type app.score as (value int4);",
      "create schema app;",
    ]);
    const unresolved = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    );
    const operatorStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create operator app.<#"),
    );

    expect(unresolved).toHaveLength(2);
    expect(operatorStatement?.requires).toContainEqual({
      kind: "function",
      schema: "app",
      name: "score_sel",
      signature: "(internal,oid,internal,int4)->float8",
    });
    expect(operatorStatement?.requires).toContainEqual({
      kind: "function",
      schema: "app",
      name: "score_join",
      signature: "(internal,oid,internal,int2,internal)->float8",
    });
  });

  test("does not require producer statements for built-in operator estimators", async () => {
    const result = await analyzeAndSort([
      "create operator app.<# (function = app.score_lt, leftarg = app.score, rightarg = app.score, restrict = eqsel, join = eqjoinsel);",
      "create function app.score_lt(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value < (b).value $$;",
      "create type app.score as (value int4);",
      "create schema app;",
    ]);
    const unknownCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNKNOWN_STATEMENT_CLASS",
    ).length;
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;

    expect(unknownCount).toBe(0);
    expect(unresolvedCount).toBe(0);

    const validation = await validateAnalyzeResultWithPostgres(result);
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const typeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.score as"),
    );
    const operatorFunctionIndex = orderedSql.findIndex((sql) =>
      sql.includes("create function app.score_lt"),
    );
    const operatorIndex = orderedSql.findIndex((sql) =>
      sql.includes("create operator app.<#"),
    );

    expect(executionErrors).toHaveLength(0);
    expect(typeIndex).toBeGreaterThanOrEqual(0);
    expect(operatorFunctionIndex).toBeGreaterThan(typeIndex);
    expect(operatorIndex).toBeGreaterThan(operatorFunctionIndex);
  }, 120000);

  test("does not require producer statements for built-in scalar boundary estimators", async () => {
    const result = await analyzeAndSort([
      "create operator app.<=# (function = app.score_le, leftarg = app.score, rightarg = app.score, restrict = scalarlesel, join = scalarlejoinsel);",
      "create operator app.>=# (function = app.score_ge, leftarg = app.score, rightarg = app.score, restrict = scalargesel, join = scalargejoinsel);",
      "create function app.score_le(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value <= (b).value $$;",
      "create function app.score_ge(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value >= (b).value $$;",
      "create type app.score as (value int4);",
      "create schema app;",
    ]);
    const unresolved = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    );

    expect(unresolved).toHaveLength(0);
  });

  test("requires estimator names in the matching restrict or join slot", async () => {
    const result = await analyzeAndSort([
      "create operator app.=== (function = texteq, leftarg = text, rightarg = text, restrict = eqjoinsel, join = eqsel);",
      "create schema app;",
    ]);
    const invalidRestrictEstimator = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.schema === "public" &&
            ref.name === "eqjoinsel" &&
            ref.signature === "(internal,oid,internal,int4)->float8",
        ) === true,
    );
    const invalidJoinEstimator = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.schema === "public" &&
            ref.name === "eqsel" &&
            ref.signature === "(internal,oid,internal,int2,internal)->float8",
        ) === true,
    );
    const operatorStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create operator app.==="),
    );

    expect(invalidRestrictEstimator).toHaveLength(1);
    expect(invalidJoinEstimator).toHaveLength(1);
    expect(operatorStatement?.requires).toContainEqual({
      kind: "function",
      schema: "public",
      name: "eqjoinsel",
      signature: "(internal,oid,internal,int4)->float8",
    });
    expect(operatorStatement?.requires).toContainEqual({
      kind: "function",
      schema: "public",
      name: "eqsel",
      signature: "(internal,oid,internal,int2,internal)->float8",
    });
  });

  test("does not require producer statements for built-in text operator implementation functions", async () => {
    const result = await analyzeAndSort([
      "create operator app.=== (function = int4eq, leftarg = int4, rightarg = int4);",
      "create schema app;",
    ]);
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const operatorStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create operator app.==="),
    );

    expect(unresolvedCount).toBe(0);
    expect(operatorStatement?.requires).not.toContainEqual({
      kind: "function",
      schema: "public",
      name: "int4eq",
      signature: "(int4,int4)",
    });

    const validation = await validateAnalyzeResultWithPostgres(result);
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const schemaIndex = orderedSql.findIndex((sql) =>
      sql.includes("create schema app"),
    );
    const operatorIndex = orderedSql.findIndex((sql) =>
      sql.includes("create operator app.==="),
    );

    expect(executionErrors).toHaveLength(0);
    expect(schemaIndex).toBeGreaterThanOrEqual(0);
    expect(operatorIndex).toBeGreaterThan(schemaIndex);
  }, 120000);

  test("does not require producer statements for non-equality built-in operator implementation functions", async () => {
    const result = await analyzeAndSort([
      "create operator app.<< (function = int4lt, leftarg = int4, rightarg = int4);",
      "create schema app;",
    ]);
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const operatorStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create operator app.<<"),
    );

    expect(unresolvedCount).toBe(0);
    expect(operatorStatement?.requires).not.toContainEqual({
      kind: "function",
      schema: "public",
      name: "int4lt",
      signature: "(int4,int4)",
    });

    const validation = await validateAnalyzeResultWithPostgres(result);
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );

    expect(executionErrors).toHaveLength(0);
  }, 120000);

  test("does not require producer statements for built-in float operator implementation functions", async () => {
    const result = await analyzeAndSort([
      "create operator app.=== (function = float8eq, leftarg = float8, rightarg = float8);",
      "create schema app;",
    ]);
    const unresolved = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    );
    const operatorStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create operator app.==="),
    );

    expect(unresolved).toHaveLength(0);
    expect(operatorStatement?.requires).not.toContainEqual({
      kind: "function",
      schema: "public",
      name: "float8eq",
      signature: "(float8,float8)",
    });
  });

  test("does not require producer statements for built-in date operator implementation functions", async () => {
    const result = await analyzeAndSort([
      "create operator app.<< (function = date_lt, leftarg = date, rightarg = date);",
      "create schema app;",
    ]);
    const unresolved = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    );
    const operatorStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create operator app.<<"),
    );

    expect(unresolved).toHaveLength(0);
    expect(operatorStatement?.requires).not.toContainEqual({
      kind: "function",
      schema: "public",
      name: "date_lt",
      signature: "(date,date)",
    });
  });

  test("does not require producers for built-in network containment callbacks", async () => {
    const result = await analyzeAndSort([
      "create operator app.&& (function = network_overlap, leftarg = inet, rightarg = inet);",
      "create operator app.<< (function = network_sub, leftarg = inet, rightarg = inet);",
      "create operator app.<<= (function = network_subeq, leftarg = inet, rightarg = inet);",
      "create operator app.>> (function = network_sup, leftarg = inet, rightarg = inet);",
      "create operator app.>>= (function = network_supeq, leftarg = inet, rightarg = inet);",
      "create schema app;",
    ]);
    const unresolvedNetworkCallbacks = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.schema === "public" &&
            ref.name.startsWith("network_"),
        ) === true,
    );

    expect(unresolvedNetworkCallbacks).toHaveLength(0);
  });

  test("requires exact operator implementation signatures", async () => {
    const result = await analyzeAndSort([
      "create operator app.=== (function = app.score_eq, leftarg = app.score, rightarg = app.score);",
      "create function app.score_eq(a app.score, b app.score, extra int4 default 0) returns boolean language sql immutable strict as $$ select (a).value = (b).value $$;",
      "create type app.score as (value int4);",
      "create schema app;",
    ]);
    const unresolvedImplementation = result.diagnostics.find(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.schema === "app" &&
            ref.name === "score_eq",
        ) === true,
    );
    const operatorStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create operator app.==="),
    );

    expect(operatorStatement?.requires).toContainEqual({
      kind: "function",
      schema: "app",
      name: "score_eq",
      signature: "(app.score,app.score)",
    });
    expect(unresolvedImplementation?.objectRefs).toContainEqual({
      kind: "function",
      schema: "app",
      name: "score_eq",
      signature: "(app.score,app.score)",
    });
  });

  test("distinguishes prefix and postfix operator signatures", async () => {
    const result = await analyzeAndSort([
      "create operator app.! (function = app.score_postfix, leftarg = app.score);",
      "create operator app.! (function = app.score_prefix, rightarg = app.score);",
      "create function app.score_postfix(value app.score) returns boolean language sql immutable strict as $$ select (value).value > 0 $$;",
      "create function app.score_prefix(value app.score) returns boolean language sql immutable strict as $$ select (value).value = 0 $$;",
      "create type app.score as (value int4);",
      "create schema app;",
    ]);
    const duplicateCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "DUPLICATE_PRODUCER",
    ).length;
    const postfixOperatorStatement = result.ordered.find(
      (statement) =>
        statement.sql.toLowerCase().startsWith("create operator app.!") &&
        statement.sql.toLowerCase().includes("score_postfix"),
    );
    const prefixOperatorStatement = result.ordered.find(
      (statement) =>
        statement.sql.toLowerCase().startsWith("create operator app.!") &&
        statement.sql.toLowerCase().includes("score_prefix"),
    );

    expect(duplicateCount).toBe(0);
    expect(postfixOperatorStatement?.provides).toContainEqual({
      kind: "operator",
      schema: "app",
      name: "!",
      signature: "(app.score,none)",
    });
    expect(prefixOperatorStatement?.provides).toContainEqual({
      kind: "operator",
      schema: "app",
      name: "!",
      signature: "(none,app.score)",
    });
  }, 120000);

  test("orders overloaded float8mi before non-float8 range subtypes", async () => {
    const result = await analyzeAndSort([
      "create table app.measurements(id int primary key, value_span app.score_range not null);",
      "create type app.score_range as range (subtype = app.score, subtype_opclass = app.score_ops, subtype_diff = float8mi);",
      "create operator class app.score_ops for type app.score using btree as operator 1 < (app.score, app.score), operator 2 <= (app.score, app.score), operator 3 = (app.score, app.score), operator 4 >= (app.score, app.score), operator 5 > (app.score, app.score), function 1 app.score_cmp(app.score, app.score);",
      "create function float8mi(a app.score, b app.score) returns float8 language sql immutable strict as $$ select ((a).value - (b).value)::float8 $$;",
      "create function app.score_cmp(a app.score, b app.score) returns int4 language sql immutable strict as $$ select case when (a).value < (b).value then -1 when (a).value > (b).value then 1 else 0 end $$;",
      "create operator > (function = app.score_gt, leftarg = app.score, rightarg = app.score);",
      "create operator >= (function = app.score_gte, leftarg = app.score, rightarg = app.score);",
      "create operator = (function = app.score_eq, leftarg = app.score, rightarg = app.score);",
      "create operator <= (function = app.score_lte, leftarg = app.score, rightarg = app.score);",
      "create operator < (function = app.score_lt, leftarg = app.score, rightarg = app.score);",
      "create function app.score_gt(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value > (b).value $$;",
      "create function app.score_gte(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value >= (b).value $$;",
      "create function app.score_eq(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value = (b).value $$;",
      "create function app.score_lte(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value <= (b).value $$;",
      "create function app.score_lt(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value < (b).value $$;",
      "create type app.score as (value float8);",
      "create schema app;",
    ]);
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const rangeStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create type app.score_range"),
    );

    expect(unresolvedCount).toBe(0);
    expect(rangeStatement?.requires).toContainEqual({
      kind: "function",
      schema: "public",
      name: "float8mi",
      signature: "(app.score,app.score)->float8",
    });

    const validation = await validateAnalyzeResultWithPostgres(result);
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const subtypeDiffIndex = orderedSql.findIndex((sql) =>
      sql.includes("create function float8mi"),
    );
    const operatorClassIndex = orderedSql.findIndex((sql) =>
      sql.includes("create operator class app.score_ops"),
    );
    const rangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.score_range"),
    );
    const tableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table app.measurements"),
    );

    expect(executionErrors).toHaveLength(0);
    expect(subtypeDiffIndex).toBeGreaterThanOrEqual(0);
    expect(operatorClassIndex).toBeGreaterThan(subtypeDiffIndex);
    expect(rangeIndex).toBeGreaterThan(operatorClassIndex);
    expect(rangeIndex).toBeGreaterThan(subtypeDiffIndex);
    expect(tableIndex).toBeGreaterThan(rangeIndex);
  }, 120000);

  test("requires canonical range functions with the range signature", async () => {
    const result = await analyzeAndSort([
      "create type app.score_range as range (subtype = int4, canonical = app.score_canonical);",
      "create function app.score_canonical(value int4) returns int4 language sql immutable as $$ select value $$;",
      "create schema app;",
    ]);
    const rangeStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create type app.score_range"),
    );
    const unresolvedCanonicalDependency = result.diagnostics.find(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.schema === "app" &&
            ref.name === "score_canonical",
        ) === true,
    );

    expect(rangeStatement?.requires).toContainEqual({
      kind: "function",
      schema: "app",
      name: "score_canonical",
      signature: "(app.score_range)->app.score_range",
    });
    expect(unresolvedCanonicalDependency?.objectRefs).toContainEqual({
      kind: "function",
      schema: "app",
      name: "score_canonical",
      signature: "(app.score_range)->app.score_range",
    });
  }, 120000);

  test("requires subtype diff range functions with subtype signatures", async () => {
    const result = await analyzeAndSort([
      "create type app.score_range as range (subtype = app.score, subtype_diff = app.score_diff);",
      "create function app.score_diff(value app.score) returns float8 language sql immutable strict as $$ select (value).value::float8 $$;",
      "create type app.score as (value int4);",
      "create schema app;",
    ]);
    const rangeStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create type app.score_range"),
    );
    const unresolvedSubtypeDiffDependency = result.diagnostics.find(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.schema === "app" &&
            ref.name === "score_diff",
        ) === true,
    );

    expect(rangeStatement?.requires).toContainEqual({
      kind: "function",
      schema: "app",
      name: "score_diff",
      signature: "(app.score,app.score)->float8",
    });
    expect(unresolvedSubtypeDiffDependency?.objectRefs).toContainEqual({
      kind: "function",
      schema: "app",
      name: "score_diff",
      signature: "(app.score,app.score)->float8",
    });
  }, 120000);

  test("matches range callbacks declared with OUT return parameters", async () => {
    const result = await analyzeAndSort([
      "create type app.int_range as range (subtype = int4, subtype_diff = app.diff);",
      "create function app.diff(a int4, b int4, out result float8) language sql immutable strict as $$ select (a - b)::float8 $$;",
      "create schema app;",
    ]);
    const unresolvedDiff = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.schema === "app" &&
            ref.name === "diff" &&
            ref.signature === "(pg_catalog.int4,pg_catalog.int4)->float8",
        ) === true,
    );
    const functionStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create function app.diff"),
    );

    expect(unresolvedDiff).toHaveLength(0);
    expect(functionStatement?.provides).toContainEqual({
      kind: "function",
      schema: "app",
      name: "diff",
      signature: "(int4,int4)->float8",
    });
  }, 120000);

  test("requires exact range support routine signatures", async () => {
    const result = await analyzeAndSort([
      "create type app.score_range as range (subtype = int4, canonical = app.score_canonical);",
      "create function app.score_canonical(value app.score_range, extra int4 default 0) returns app.score_range language sql immutable as $$ select value $$;",
      "create type app.score_range;",
      "create schema app;",
    ]);
    const unresolvedCanonicalDependency = result.diagnostics.find(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.schema === "app" &&
            ref.name === "score_canonical",
        ) === true,
    );
    const rangeStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create type app.score_range as"),
    );

    expect(rangeStatement?.requires).toContainEqual({
      kind: "function",
      schema: "app",
      name: "score_canonical",
      signature: "(app.score_range)->app.score_range",
    });
    expect(unresolvedCanonicalDependency?.objectRefs).toContainEqual({
      kind: "function",
      schema: "app",
      name: "score_canonical",
      signature: "(app.score_range)->app.score_range",
    });
  });

  test("does not satisfy exact range callbacks with polymorphic overloads", async () => {
    const result = await analyzeAndSort([
      "create type app.score_range as range (subtype = int4, canonical = app.score_canonical, subtype_diff = app.score_diff);",
      "create function app.score_canonical(value anyrange) returns anyrange language sql immutable as $$ select value $$;",
      "create function app.score_diff(left_value anyelement, right_value anyelement) returns float8 language sql immutable as $$ select 0::float8 $$;",
      "create schema app;",
    ]);
    const unresolvedCanonicalDependency = result.diagnostics.find(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.schema === "app" &&
            ref.name === "score_canonical" &&
            ref.signature === "(app.score_range)->app.score_range",
        ) === true,
    );
    const unresolvedSubtypeDiffDependency = result.diagnostics.find(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.schema === "app" &&
            ref.name === "score_diff" &&
            ref.signature === "(pg_catalog.int4,pg_catalog.int4)->float8",
        ) === true,
    );

    expect(unresolvedCanonicalDependency).toBeDefined();
    expect(unresolvedSubtypeDiffDependency).toBeDefined();
  });

  test("requires custom opclass functions when built-in names use different argument types", async () => {
    const result = await analyzeAndSort([
      "create operator class app.uuid_range_ops for type uuid using btree as operator 1 < (uuid, uuid), operator 2 <= (uuid, uuid), operator 3 = (uuid, uuid), operator 4 >= (uuid, uuid), operator 5 > (uuid, uuid), function 1 btint4cmp(uuid, uuid);",
      "create function btint4cmp(a uuid, b uuid) returns int4 language sql immutable strict as $$ select case when a < b then -1 when a > b then 1 else 0 end $$;",
      "create schema app;",
    ]);
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const operatorClassStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator class app.uuid_range_ops"),
    );

    expect(unresolvedCount).toBe(0);
    expect(operatorClassStatement?.requires).toContainEqual({
      kind: "function",
      schema: "public",
      name: "btint4cmp",
      signature: "(uuid,uuid)->int4",
    });

    const validation = await validateAnalyzeResultWithPostgres(result);
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const supportFunctionIndex = orderedSql.findIndex((sql) =>
      sql.includes("create function btint4cmp"),
    );
    const operatorClassIndex = orderedSql.findIndex((sql) =>
      sql.includes("create operator class app.uuid_range_ops"),
    );

    expect(executionErrors).toHaveLength(0);
    expect(supportFunctionIndex).toBeGreaterThanOrEqual(0);
    expect(operatorClassIndex).toBeGreaterThan(supportFunctionIndex);
  }, 120000);

  test("requires exact opclass support function signatures", async () => {
    const result = await analyzeAndSort([
      "create operator class app.score_ops for type app.score using btree as operator 1 app.< (app.score, app.score), function 1 app.score_cmp(app.score, app.score);",
      "create operator app.< (function = app.score_lt, leftarg = app.score, rightarg = app.score);",
      "create function app.score_cmp(a app.score, b app.score, extra int4 default 0) returns int4 language sql immutable strict as $$ select (a).value - (b).value + extra $$;",
      "create function app.score_lt(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value < (b).value $$;",
      "create type app.score as (value int4);",
      "create schema app;",
    ]);
    const unresolvedSupportFunction = result.diagnostics.find(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.schema === "app" &&
            ref.name === "score_cmp",
        ) === true,
    );
    const operatorClassStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator class app.score_ops"),
    );

    expect(operatorClassStatement?.requires).toContainEqual({
      kind: "function",
      schema: "app",
      name: "score_cmp",
      signature: "(app.score,app.score)->int4",
    });
    expect(unresolvedSupportFunction?.objectRefs).toContainEqual({
      kind: "function",
      schema: "app",
      name: "score_cmp",
      signature: "(app.score,app.score)->int4",
    });
  }, 120000);

  test("infers omitted opclass support function signatures", async () => {
    const result = await analyzeAndSort([
      "create operator class app.score_ops for type app.score using btree as operator 1 app.< (app.score, app.score), function 1 app.score_cmp;",
      "create operator app.< (function = app.score_lt, leftarg = app.score, rightarg = app.score);",
      "create function app.score_cmp(a app.score, b app.score, extra int4 default 0) returns int4 language sql immutable strict as $$ select (a).value - (b).value + extra $$;",
      "create function app.score_lt(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value < (b).value $$;",
      "create type app.score as (value int4);",
      "create schema app;",
    ]);
    const unresolvedSupportFunction = result.diagnostics.find(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.schema === "app" &&
            ref.name === "score_cmp",
        ) === true,
    );
    const operatorClassStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator class app.score_ops"),
    );

    expect(operatorClassStatement?.requires).toContainEqual({
      kind: "function",
      schema: "app",
      name: "score_cmp",
      signature: "(app.score,app.score)->int4",
    });
    expect(unresolvedSupportFunction?.objectRefs).toContainEqual({
      kind: "function",
      schema: "app",
      name: "score_cmp",
      signature: "(app.score,app.score)->int4",
    });
  }, 120000);

  test("does not require producer statements for built-in opclass sortsupport functions", async () => {
    const result = await analyzeAndSort([
      "create operator class app.int4_sort_ops for type int4 using btree as operator 1 < (int4, int4), operator 2 <= (int4, int4), operator 3 = (int4, int4), operator 4 >= (int4, int4), operator 5 > (int4, int4), function 1 btint4cmp(int4, int4), function 2 btint4sortsupport(internal);",
      "create schema app;",
    ]);
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const operatorClassStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator class app.int4_sort_ops"),
    );

    expect(unresolvedCount).toBe(0);
    expect(operatorClassStatement?.requires).not.toContainEqual({
      kind: "function",
      schema: "public",
      name: "btint4sortsupport",
      signature: "(internal)->void",
    });
  }, 120000);

  test("does not require producer statements for built-in cross-type opclass support functions", async () => {
    const result = await analyzeAndSort([
      "create operator class app.int4_cross_ops for type int4 using btree as operator 1 < (int4, int4), function 1 (int4, int8) btint48cmp(int4, int8);",
      "create schema app;",
    ]);
    const unresolved = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    );
    const operatorClassStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator class app.int4_cross_ops"),
    );

    expect(unresolved).toHaveLength(0);
    expect(operatorClassStatement?.requires).not.toContainEqual({
      kind: "function",
      schema: "public",
      name: "btint48cmp",
      signature: "(int4,int8)->int4",
    });
  });

  test("does not require producers for date/time in_range support functions", async () => {
    const result = await analyzeAndSort([
      "create operator class app.date_window_ops for type date using btree as operator 1 < (date, date), function 1 date_cmp(date, date), function 3 (date, interval) in_range(date, date, interval, bool, bool);",
      "create operator class app.time_window_ops for type time using btree as operator 1 < (time, time), function 1 time_cmp(time, time), function 3 (time, interval) in_range(time, time, interval, bool, bool);",
      "create operator class app.timetz_window_ops for type timetz using btree as operator 1 < (timetz, timetz), function 1 timetz_cmp(timetz, timetz), function 3 (timetz, interval) in_range(timetz, timetz, interval, bool, bool);",
      "create operator class app.timestamp_window_ops for type timestamp using btree as operator 1 < (timestamp, timestamp), function 1 timestamp_cmp(timestamp, timestamp), function 3 (timestamp, interval) in_range(timestamp, timestamp, interval, bool, bool);",
      "create operator class app.timestamptz_window_ops for type timestamptz using btree as operator 1 < (timestamptz, timestamptz), function 1 timestamptz_cmp(timestamptz, timestamptz), function 3 (timestamptz, interval) in_range(timestamptz, timestamptz, interval, bool, bool);",
      "create schema app;",
    ]);
    const unresolvedInRange = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) => ref.kind === "function" && ref.name === "in_range",
        ) === true,
    );
    const inRangeRequirements = result.ordered.flatMap((statement) =>
      statement.requires.filter(
        (ref) => ref.kind === "function" && ref.name === "in_range",
      ),
    );

    expect(unresolvedInRange).toHaveLength(0);
    expect(inRangeRequirements).toHaveLength(0);
  });

  test("does not require producers for btree skip support functions", async () => {
    const result = await analyzeAndSort([
      "create operator class app.int4_skip_ops for type int4 using btree as operator 1 < (int4, int4), function 1 btint4cmp(int4, int4), function 6 btint4skipsupport(internal);",
      "create schema app;",
    ]);
    const unresolvedSkipSupport = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.schema === "public" &&
            ref.name === "btint4skipsupport",
        ) === true,
    );
    const skipSupportRequirements = result.ordered.flatMap((statement) =>
      statement.requires.filter(
        (ref) => ref.kind === "function" && ref.name === "btint4skipsupport",
      ),
    );

    expect(unresolvedSkipSupport).toHaveLength(0);
    expect(skipSupportRequirements).toHaveLength(0);
  });

  test("orders custom btree skip support functions before operator classes", async () => {
    const result = await analyzeAndSort([
      "create operator class app.score_skip_ops for type int4 using btree as operator 1 < (int4, int4), function 1 btint4cmp(int4, int4), function 6 btscore_skipsupport(internal);",
      "create function btscore_skipsupport(internal) returns void language internal immutable strict as 'btint4skipsupport';",
      "create schema app;",
    ]);
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const supportFunctionIndex = orderedSql.findIndex((sql) =>
      sql.includes("create function btscore_skipsupport"),
    );
    const operatorClassIndex = orderedSql.findIndex((sql) =>
      sql.includes("create operator class app.score_skip_ops"),
    );
    const operatorClassStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator class app.score_skip_ops"),
    );

    expect(operatorClassStatement?.requires).toContainEqual({
      kind: "function",
      schema: "public",
      name: "btscore_skipsupport",
      signature: "(internal)->void",
    });
    expect(supportFunctionIndex).toBeGreaterThanOrEqual(0);
    expect(operatorClassIndex).toBeGreaterThan(supportFunctionIndex);
  });

  test("does not require producers for pg_catalog cross-type support operators", async () => {
    const result = await analyzeAndSort([
      "create operator class app.int4_cross_ops for type int4 using btree as operator 1 < (int4, int8), function 1 (int4, int8) btint48cmp(int4, int8);",
      "create schema app;",
    ]);
    const unresolvedCrossTypeOperator = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "operator" &&
            ref.name === "<" &&
            ref.signature?.includes("int4") === true &&
            ref.signature?.includes("int8") === true,
        ) === true,
    );
    const operatorClassStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator class app.int4_cross_ops"),
    );

    expect(unresolvedCrossTypeOperator).toHaveLength(0);
    expect(
      operatorClassStatement?.requires.some(
        (ref) => ref.kind === "operator" && ref.name === "<",
      ),
    ).toBe(false);
  });

  test("orders custom subtype opclasses with built-in names before range types", async () => {
    const result = await analyzeAndSort([
      "set search_path = public, pg_catalog;",
      "create table app.measurements(id int primary key, value_span app.score_range not null);",
      "create type app.score_range as range (subtype = app.score, subtype_opclass = int4_ops);",
      "create operator class int4_ops for type app.score using btree as operator 1 < (app.score, app.score), operator 2 <= (app.score, app.score), operator 3 = (app.score, app.score), operator 4 >= (app.score, app.score), operator 5 > (app.score, app.score), function 1 app.score_cmp(app.score, app.score);",
      "create function app.score_cmp(a app.score, b app.score) returns int4 language sql immutable strict as $$ select case when (a).value < (b).value then -1 when (a).value > (b).value then 1 else 0 end $$;",
      "create operator > (function = app.score_gt, leftarg = app.score, rightarg = app.score);",
      "create operator >= (function = app.score_gte, leftarg = app.score, rightarg = app.score);",
      "create operator = (function = app.score_eq, leftarg = app.score, rightarg = app.score);",
      "create operator <= (function = app.score_lte, leftarg = app.score, rightarg = app.score);",
      "create operator < (function = app.score_lt, leftarg = app.score, rightarg = app.score);",
      "create function app.score_gt(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value > (b).value $$;",
      "create function app.score_gte(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value >= (b).value $$;",
      "create function app.score_eq(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value = (b).value $$;",
      "create function app.score_lte(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value <= (b).value $$;",
      "create function app.score_lt(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value < (b).value $$;",
      "create type app.score as (value int4);",
      "create schema app;",
    ]);
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const rangeStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create type app.score_range"),
    );

    expect(unresolvedCount).toBe(0);
    expect(rangeStatement?.requires).toContainEqual({
      kind: "operator_class",
      schema: "public",
      name: "int4_ops",
      signature: "(btree,app.score)",
    });

    const validation = await validateAnalyzeResultWithPostgres(result);
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const operatorClassIndex = orderedSql.findIndex((sql) =>
      sql.includes("create operator class int4_ops"),
    );
    const rangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.score_range"),
    );
    const tableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table app.measurements"),
    );

    expect(executionErrors).toHaveLength(0);
    expect(operatorClassIndex).toBeGreaterThanOrEqual(0);
    expect(rangeIndex).toBeGreaterThan(operatorClassIndex);
    expect(tableIndex).toBeGreaterThan(rangeIndex);
  }, 120000);

  test("orders custom range types after default subtype operator classes", async () => {
    const result = await analyzeAndSort([
      "create table app.measurements(id int primary key, value_span app.score_range not null);",
      "create type app.score_range as range (subtype = app.score);",
      "create operator class app.score_ops default for type app.score using btree as operator 1 < (app.score, app.score), operator 2 <= (app.score, app.score), operator 3 = (app.score, app.score), operator 4 >= (app.score, app.score), operator 5 > (app.score, app.score), function 1 app.score_cmp(app.score, app.score);",
      "create function app.score_cmp(a app.score, b app.score) returns int4 language sql immutable strict as $$ select case when (a).value < (b).value then -1 when (a).value > (b).value then 1 else 0 end $$;",
      "create operator > (function = app.score_gt, leftarg = app.score, rightarg = app.score);",
      "create operator >= (function = app.score_gte, leftarg = app.score, rightarg = app.score);",
      "create operator = (function = app.score_eq, leftarg = app.score, rightarg = app.score);",
      "create operator <= (function = app.score_lte, leftarg = app.score, rightarg = app.score);",
      "create operator < (function = app.score_lt, leftarg = app.score, rightarg = app.score);",
      "create function app.score_gt(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value > (b).value $$;",
      "create function app.score_gte(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value >= (b).value $$;",
      "create function app.score_eq(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value = (b).value $$;",
      "create function app.score_lte(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value <= (b).value $$;",
      "create function app.score_lt(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value < (b).value $$;",
      "create type app.score as (value int4);",
      "create schema app;",
    ]);
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const rangeStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create type app.score_range"),
    );

    expect(unresolvedCount).toBe(0);
    expect(rangeStatement?.requires).toContainEqual({
      kind: "operator_class",
      schema: "app",
      name: "score_ops",
      signature: "(btree,app.score)",
    });

    const validation = await validateAnalyzeResultWithPostgres(result);
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const operatorClassIndex = orderedSql.findIndex((sql) =>
      sql.includes("create operator class app.score_ops"),
    );
    const rangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.score_range"),
    );
    const tableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table app.measurements"),
    );

    expect(executionErrors).toHaveLength(0);
    expect(operatorClassIndex).toBeGreaterThanOrEqual(0);
    expect(rangeIndex).toBeGreaterThan(operatorClassIndex);
    expect(tableIndex).toBeGreaterThan(rangeIndex);
  }, 120000);

  test("orders custom range types after any default subtype operator class name", async () => {
    const result = await analyzeAndSort([
      "create table app.measurements(id int primary key, value_span app.score_range not null);",
      "create type app.score_range as range (subtype = app.score);",
      "create operator class app.my_score_default default for type app.score using btree as operator 1 < (app.score, app.score), operator 2 <= (app.score, app.score), operator 3 = (app.score, app.score), operator 4 >= (app.score, app.score), operator 5 > (app.score, app.score), function 1 app.score_cmp(app.score, app.score);",
      "create function app.score_cmp(a app.score, b app.score) returns int4 language sql immutable strict as $$ select case when (a).value < (b).value then -1 when (a).value > (b).value then 1 else 0 end $$;",
      "create operator > (function = app.score_gt, leftarg = app.score, rightarg = app.score);",
      "create operator >= (function = app.score_gte, leftarg = app.score, rightarg = app.score);",
      "create operator = (function = app.score_eq, leftarg = app.score, rightarg = app.score);",
      "create operator <= (function = app.score_lte, leftarg = app.score, rightarg = app.score);",
      "create operator < (function = app.score_lt, leftarg = app.score, rightarg = app.score);",
      "create function app.score_gt(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value > (b).value $$;",
      "create function app.score_gte(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value >= (b).value $$;",
      "create function app.score_eq(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value = (b).value $$;",
      "create function app.score_lte(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value <= (b).value $$;",
      "create function app.score_lt(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value < (b).value $$;",
      "create type app.score as (value int4);",
      "create schema app;",
    ]);
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const rangeStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create type app.score_range"),
    );

    expect(unresolvedCount).toBe(0);
    expect(rangeStatement?.requires).toContainEqual({
      kind: "operator_class",
      schema: "app",
      name: "my_score_default",
      signature: "(btree,app.score)",
    });

    const validation = await validateAnalyzeResultWithPostgres(result);
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const operatorClassIndex = orderedSql.findIndex((sql) =>
      sql.includes("create operator class app.my_score_default"),
    );
    const rangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.score_range"),
    );
    const tableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table app.measurements"),
    );

    expect(executionErrors).toHaveLength(0);
    expect(operatorClassIndex).toBeGreaterThanOrEqual(0);
    expect(rangeIndex).toBeGreaterThan(operatorClassIndex);
    expect(tableIndex).toBeGreaterThan(rangeIndex);
  }, 120000);

  test("does not require producer statements for built-in opclass operators without argument lists", async () => {
    const result = await analyzeAndSort([
      "create table app.measurements(id int primary key, value_span app.custom_int4_range not null);",
      "create type app.custom_int4_range as range (subtype = int4, subtype_opclass = app.int4_range_ops);",
      "create operator class app.int4_range_ops for type int4 using btree as operator 1 <, operator 2 <=, operator 3 =, operator 4 >=, operator 5 >, function 1 btint4cmp(int4, int4);",
      "create schema app;",
    ]);
    const unknownCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNKNOWN_STATEMENT_CLASS",
    ).length;
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;

    expect(unknownCount).toBe(0);
    expect(unresolvedCount).toBe(0);

    const validation = await validateAnalyzeResultWithPostgres(result);
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const schemaIndex = orderedSql.findIndex((sql) =>
      sql.includes("create schema app"),
    );
    const operatorClassIndex = orderedSql.findIndex((sql) =>
      sql.includes("create operator class app.int4_range_ops"),
    );
    const rangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.custom_int4_range"),
    );
    const tableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table app.measurements"),
    );

    expect(executionErrors).toHaveLength(0);
    expect(schemaIndex).toBeGreaterThanOrEqual(0);
    expect(operatorClassIndex).toBeGreaterThan(schemaIndex);
    expect(rangeIndex).toBeGreaterThan(operatorClassIndex);
    expect(tableIndex).toBeGreaterThan(rangeIndex);
  }, 120000);

  test("orders operator classes after explicit operator families", async () => {
    const result = await analyzeAndSort([
      "create table app.measurements(id int primary key, value_span app.score_range not null);",
      "create type app.score_range as range (subtype = app.score, subtype_opclass = app.score_ops);",
      "create operator class app.score_ops for type app.score using btree family app.score_family as operator 1 < (app.score, app.score), operator 2 <= (app.score, app.score), operator 3 = (app.score, app.score), operator 4 >= (app.score, app.score), operator 5 > (app.score, app.score), function 1 app.score_cmp(app.score, app.score);",
      "create operator family app.score_family using btree;",
      "create function app.score_cmp(a app.score, b app.score) returns int4 language sql immutable strict as $$ select case when (a).value < (b).value then -1 when (a).value > (b).value then 1 else 0 end $$;",
      "create operator > (function = app.score_gt, leftarg = app.score, rightarg = app.score);",
      "create operator >= (function = app.score_gte, leftarg = app.score, rightarg = app.score);",
      "create operator = (function = app.score_eq, leftarg = app.score, rightarg = app.score);",
      "create operator <= (function = app.score_lte, leftarg = app.score, rightarg = app.score);",
      "create operator < (function = app.score_lt, leftarg = app.score, rightarg = app.score);",
      "create function app.score_gt(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value > (b).value $$;",
      "create function app.score_gte(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value >= (b).value $$;",
      "create function app.score_eq(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value = (b).value $$;",
      "create function app.score_lte(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value <= (b).value $$;",
      "create function app.score_lt(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value < (b).value $$;",
      "create type app.score as (value int4);",
      "create schema app;",
    ]);
    const unknownCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNKNOWN_STATEMENT_CLASS",
    ).length;
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const operatorClassStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator class app.score_ops"),
    );

    expect(unknownCount).toBe(0);
    expect(unresolvedCount).toBe(0);
    expect(operatorClassStatement?.requires).toContainEqual({
      kind: "operator_family",
      schema: "app",
      name: "score_family",
      signature: "(btree)",
    });

    const validation = await validateAnalyzeResultWithPostgres(result);
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const familyIndex = orderedSql.findIndex((sql) =>
      sql.includes("create operator family app.score_family"),
    );
    const operatorClassIndex = orderedSql.findIndex((sql) =>
      sql.includes("create operator class app.score_ops"),
    );
    const rangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.score_range"),
    );
    const tableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table app.measurements"),
    );

    expect(executionErrors).toHaveLength(0);
    expect(familyIndex).toBeGreaterThanOrEqual(0);
    expect(operatorClassIndex).toBeGreaterThan(familyIndex);
    expect(rangeIndex).toBeGreaterThan(operatorClassIndex);
    expect(tableIndex).toBeGreaterThan(rangeIndex);
  }, 120000);

  test("orders operator classes after operator families used for ordering", async () => {
    const result = await analyzeAndSort([
      "create operator class app.score_ops for type app.score using gist as operator 1 <-> (app.score, app.score) for order by app.score_sort_family, function 1 app.score_consistent(internal, app.score, smallint, oid, internal), function 2 app.score_union(internal, internal), function 3 app.score_compress(internal), function 4 app.score_decompress(internal), function 5 app.score_penalty(internal, internal, internal), function 6 app.score_picksplit(internal, internal), function 7 app.score_same(app.score, app.score, internal);",
      "create operator family app.score_sort_family using btree;",
      "create operator <-> (function = app.score_distance, leftarg = app.score, rightarg = app.score);",
      "create function app.score_consistent(internal, app.score, smallint, oid, internal) returns bool language internal immutable strict as 'gbt_int4_consistent';",
      "create function app.score_union(internal, internal) returns app.score language internal immutable strict as 'gbt_int4_union';",
      "create function app.score_compress(internal) returns internal language internal immutable strict as 'gbt_int4_compress';",
      "create function app.score_decompress(internal) returns internal language internal immutable strict as 'gbt_int4_decompress';",
      "create function app.score_penalty(internal, internal, internal) returns internal language internal immutable strict as 'gbt_int4_penalty';",
      "create function app.score_picksplit(internal, internal) returns internal language internal immutable strict as 'gbt_int4_picksplit';",
      "create function app.score_same(app.score, app.score, internal) returns internal language internal immutable strict as 'gbt_int4_same';",
      "create function app.score_distance(a app.score, b app.score) returns float8 language sql immutable strict as $$ select abs((a).value - (b).value)::float8 $$;",
      "create type app.score as (value int4);",
      "create schema app;",
    ]);
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const operatorClassStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator class app.score_ops"),
    );

    expect(unresolvedCount).toBe(0);
    expect(operatorClassStatement?.requires).toContainEqual({
      kind: "operator_family",
      schema: "app",
      name: "score_sort_family",
      signature: "(btree)",
    });

    const validation = await validateAnalyzeResultWithPostgres(result);
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const familyIndex = orderedSql.findIndex((sql) =>
      sql.includes("create operator family app.score_sort_family"),
    );
    const operatorClassIndex = orderedSql.findIndex((sql) =>
      sql.includes("create operator class app.score_ops"),
    );

    expect(executionErrors).toHaveLength(0);
    expect(familyIndex).toBeGreaterThanOrEqual(0);
    expect(operatorClassIndex).toBeGreaterThan(familyIndex);
  }, 120000);

  test("matches order-by operator family signatures to providers", async () => {
    const result = await analyzeAndSort([
      "create operator class app.score_ops for type app.score using gist as operator 1 <-> (app.score, app.score) for order by app.score_sort_family, function 1 app.score_consistent(internal, app.score, smallint, oid, internal), function 2 app.score_union(internal, internal), function 3 app.score_compress(internal), function 4 app.score_decompress(internal), function 5 app.score_penalty(internal, internal, internal), function 6 app.score_picksplit(internal, internal), function 7 app.score_same(app.score, app.score, internal);",
      "create operator family app.score_sort_family using btree;",
      "create operator <-> (function = app.score_distance, leftarg = app.score, rightarg = app.score);",
      "create function app.score_consistent(internal, app.score, smallint, oid, internal) returns bool language internal immutable strict as 'gbt_int4_consistent';",
      "create function app.score_union(internal, internal) returns app.score language internal immutable strict as 'gbt_int4_union';",
      "create function app.score_compress(internal) returns internal language internal immutable strict as 'gbt_int4_compress';",
      "create function app.score_decompress(internal) returns internal language internal immutable strict as 'gbt_int4_decompress';",
      "create function app.score_penalty(internal, internal, internal) returns internal language internal immutable strict as 'gbt_int4_penalty';",
      "create function app.score_picksplit(internal, internal) returns internal language internal immutable strict as 'gbt_int4_picksplit';",
      "create function app.score_same(app.score, app.score, internal) returns internal language internal immutable strict as 'gbt_int4_same';",
      "create function app.score_distance(a app.score, b app.score) returns float8 language sql immutable strict as $$ select abs((a).value - (b).value)::float8 $$;",
      "create type app.score as (value int4);",
      "create schema app;",
    ]);
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const operatorFamilyStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator family app.score_sort_family"),
    );
    const operatorClassStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator class app.score_ops"),
    );

    expect(unresolvedCount).toBe(0);
    expect(operatorFamilyStatement?.provides).toContainEqual({
      kind: "operator_family",
      schema: "app",
      name: "score_sort_family",
      signature: "(btree)",
    });
    expect(operatorClassStatement?.requires).toContainEqual({
      kind: "operator_family",
      schema: "app",
      name: "score_sort_family",
      signature: "(btree)",
    });
  });

  test("does not require producer statements for built-in order-by operator families", async () => {
    const result = await analyzeAndSort([
      "create operator class app.score_float_ops for type app.score using gist as operator 1 <-> (app.score, app.score) for order by float_ops, function 1 app.score_consistent(internal, app.score, smallint, oid, internal), function 2 app.score_union(internal, internal), function 3 app.score_compress(internal), function 4 app.score_decompress(internal), function 5 app.score_penalty(internal, internal, internal), function 6 app.score_picksplit(internal, internal), function 7 app.score_same(app.score, app.score, internal);",
      "create operator class app.score_integer_ops for type app.score using gist as operator 1 <#> (app.score, app.score) for order by integer_ops, function 1 app.score_consistent(internal, app.score, smallint, oid, internal), function 2 app.score_union(internal, internal), function 3 app.score_compress(internal), function 4 app.score_decompress(internal), function 5 app.score_penalty(internal, internal, internal), function 6 app.score_picksplit(internal, internal), function 7 app.score_same(app.score, app.score, internal);",
      "create operator <-> (function = app.score_distance, leftarg = app.score, rightarg = app.score);",
      "create operator <#> (function = app.score_rank, leftarg = app.score, rightarg = app.score);",
      "create function app.score_consistent(internal, app.score, smallint, oid, internal) returns bool language internal immutable strict as 'gbt_int4_consistent';",
      "create function app.score_union(internal, internal) returns app.score language internal immutable strict as 'gbt_int4_union';",
      "create function app.score_compress(internal) returns internal language internal immutable strict as 'gbt_int4_compress';",
      "create function app.score_decompress(internal) returns internal language internal immutable strict as 'gbt_int4_decompress';",
      "create function app.score_penalty(internal, internal, internal) returns internal language internal immutable strict as 'gbt_int4_penalty';",
      "create function app.score_picksplit(internal, internal) returns internal language internal immutable strict as 'gbt_int4_picksplit';",
      "create function app.score_same(app.score, app.score, internal) returns internal language internal immutable strict as 'gbt_int4_same';",
      "create function app.score_distance(a app.score, b app.score) returns float8 language sql immutable strict as $$ select abs((a).value - (b).value)::float8 $$;",
      "create function app.score_rank(a app.score, b app.score) returns int4 language sql immutable strict as $$ select abs((a).value - (b).value) $$;",
      "create type app.score as (value int4);",
      "create schema app;",
    ]);
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const floatOperatorClassStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator class app.score_float_ops"),
    );
    const integerOperatorClassStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator class app.score_integer_ops"),
    );

    expect(unresolvedCount).toBe(0);
    expect(floatOperatorClassStatement?.requires).not.toContainEqual({
      kind: "operator_family",
      schema: "public",
      name: "float_ops",
      signature: "(btree)",
    });
    expect(integerOperatorClassStatement?.requires).not.toContainEqual({
      kind: "operator_family",
      schema: "public",
      name: "integer_ops",
      signature: "(btree)",
    });
  });

  test("does not require producer statements for unqualified built-in operator class families", async () => {
    const result = await analyzeAndSort([
      "create operator class app.score_ops for type app.score using btree family integer_ops as operator 1 app.< (app.score, app.score), operator 2 app.<= (app.score, app.score), operator 3 app.= (app.score, app.score), operator 4 app.>= (app.score, app.score), operator 5 app.> (app.score, app.score), function 1 app.score_cmp(app.score, app.score);",
      "create operator app.> (function = app.score_gt, leftarg = app.score, rightarg = app.score);",
      "create operator app.>= (function = app.score_gte, leftarg = app.score, rightarg = app.score);",
      "create operator app.= (function = app.score_eq, leftarg = app.score, rightarg = app.score);",
      "create operator app.<= (function = app.score_lte, leftarg = app.score, rightarg = app.score);",
      "create operator app.< (function = app.score_lt, leftarg = app.score, rightarg = app.score);",
      "create function app.score_cmp(a app.score, b app.score) returns int4 language sql immutable strict as $$ select case when (a).value < (b).value then -1 when (a).value > (b).value then 1 else 0 end $$;",
      "create function app.score_gt(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value > (b).value $$;",
      "create function app.score_gte(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value >= (b).value $$;",
      "create function app.score_eq(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value = (b).value $$;",
      "create function app.score_lte(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value <= (b).value $$;",
      "create function app.score_lt(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value < (b).value $$;",
      "create type app.score as (value int4);",
      "create schema app;",
    ]);
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const operatorClassStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator class app.score_ops"),
    );

    expect(unresolvedCount).toBe(0);
    expect(operatorClassStatement?.requires).not.toContainEqual({
      kind: "operator_family",
      schema: "public",
      name: "integer_ops",
      signature: "(btree)",
    });
  });

  test("does not require producer statements for pg_catalog hash operator class families", async () => {
    const result = await analyzeAndSort([
      "create operator class app.int4_hash_ops for type int4 using hash family pg_catalog.integer_ops as operator 1 = (int4, int4), function 1 hashint4(int4);",
      "create schema app;",
    ]);
    const unresolved = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    );
    const operatorClassStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator class app.int4_hash_ops"),
    );

    expect(unresolved).toHaveLength(0);
    expect(operatorClassStatement?.requires).not.toContainEqual({
      kind: "operator_family",
      schema: "pg_catalog",
      name: "integer_ops",
      signature: "(hash)",
    });
  });

  test("reports pg_catalog operator class families for nonmatching access methods", async () => {
    const result = await analyzeAndSort([
      "create operator class app.score_ops for type app.score using gist family pg_catalog.integer_ops as operator 1 <-> (app.score, app.score), function 1 app.score_consistent(internal, app.score, smallint, oid, internal);",
      "create operator app.<-> (function = app.score_distance, leftarg = app.score, rightarg = app.score);",
      "create function app.score_consistent(internal, app.score, smallint, oid, internal) returns bool language internal immutable strict as 'gbt_int4_consistent';",
      "create function app.score_distance(a app.score, b app.score) returns float8 language sql immutable strict as $$ select abs((a).value - (b).value)::float8 $$;",
      "create type app.score as (value int4);",
      "create schema app;",
    ]);
    const mismatchedFamily = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "operator_family" &&
            ref.schema === "pg_catalog" &&
            ref.name === "integer_ops" &&
            ref.signature === "(gist)",
        ) === true,
    );

    expect(mismatchedFamily).toHaveLength(1);
  });

  test("reports pg_catalog opclass names that are not operator families", async () => {
    const result = await analyzeAndSort([
      "create operator class app.bad_family_ops for type int4 using btree family pg_catalog.int4_ops as operator 1 < (int4, int4), function 1 btint4cmp(int4, int4);",
      "create schema app;",
    ]);
    const invalidFamily = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "operator_family" &&
            ref.schema === "pg_catalog" &&
            ref.name === "int4_ops" &&
            ref.signature === "(btree)",
        ) === true,
    );

    expect(invalidFamily).toHaveLength(1);
  });

  test("preserves local order-by operator families with built-in names", async () => {
    const result = await analyzeAndSort([
      "set search_path = public, pg_catalog;",
      "create operator class app.score_ops for type app.score using gist as operator 1 <-> (app.score, app.score) for order by integer_ops, function 1 app.score_consistent(internal, app.score, smallint, oid, internal), function 2 app.score_union(internal, internal), function 3 app.score_compress(internal), function 4 app.score_decompress(internal), function 5 app.score_penalty(internal, internal, internal), function 6 app.score_picksplit(internal, internal), function 7 app.score_same(app.score, app.score, internal);",
      "create operator family integer_ops using btree;",
      "create operator <-> (function = app.score_distance, leftarg = app.score, rightarg = app.score);",
      "create function app.score_consistent(internal, app.score, smallint, oid, internal) returns bool language internal immutable strict as 'gbt_int4_consistent';",
      "create function app.score_union(internal, internal) returns app.score language internal immutable strict as 'gbt_int4_union';",
      "create function app.score_compress(internal) returns internal language internal immutable strict as 'gbt_int4_compress';",
      "create function app.score_decompress(internal) returns internal language internal immutable strict as 'gbt_int4_decompress';",
      "create function app.score_penalty(internal, internal, internal) returns internal language internal immutable strict as 'gbt_int4_penalty';",
      "create function app.score_picksplit(internal, internal) returns internal language internal immutable strict as 'gbt_int4_picksplit';",
      "create function app.score_same(app.score, app.score, internal) returns internal language internal immutable strict as 'gbt_int4_same';",
      "create function app.score_distance(a app.score, b app.score) returns float8 language sql immutable strict as $$ select abs((a).value - (b).value)::float8 $$;",
      "create type app.score as (value int4);",
      "create schema app;",
    ]);
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const operatorClassStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator class app.score_ops"),
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const familyIndex = orderedSql.findIndex((sql) =>
      sql.includes("create operator family integer_ops"),
    );
    const operatorClassIndex = orderedSql.findIndex((sql) =>
      sql.includes("create operator class app.score_ops"),
    );

    expect(unresolvedCount).toBe(0);
    expect(operatorClassStatement?.requires).toContainEqual({
      kind: "operator_family",
      schema: "public",
      name: "integer_ops",
      signature: "(btree)",
    });
    expect(familyIndex).toBeGreaterThanOrEqual(0);
    expect(operatorClassIndex).toBeGreaterThan(familyIndex);
  });

  test("preserves implicit local order-by operator families with built-in names", async () => {
    const result = await analyzeAndSort([
      "set search_path = public, pg_catalog;",
      "create operator class app.score_ops for type app.score using gist as operator 1 <-> (app.score, app.score) for order by float_ops, function 1 app.score_consistent(internal, app.score, smallint, oid, internal);",
      "create operator class float_ops for type app.score using btree as operator 1 < (app.score, app.score), function 1 app.score_cmp(app.score, app.score);",
      "create operator <-> (function = app.score_distance, leftarg = app.score, rightarg = app.score);",
      "create operator < (function = app.score_lt, leftarg = app.score, rightarg = app.score);",
      "create function app.score_consistent(internal, app.score, smallint, oid, internal) returns bool language internal immutable strict as 'gbt_int4_consistent';",
      "create function app.score_cmp(a app.score, b app.score) returns int4 language sql immutable strict as $$ select case when (a).value < (b).value then -1 when (a).value > (b).value then 1 else 0 end $$;",
      "create function app.score_distance(a app.score, b app.score) returns int4 language sql immutable strict as $$ select abs((a).value - (b).value) $$;",
      "create function app.score_lt(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value < (b).value $$;",
      "create type app.score as (value int4);",
      "create schema app;",
    ]);
    const missingFloatReturn = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "operator" &&
            ref.schema === "public" &&
            ref.name === "<->" &&
            ref.signature === "(app.score,app.score)->float8",
        ) === true,
    );
    const operatorClassStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator class app.score_ops"),
    );

    expect(missingFloatReturn).toHaveLength(0);
    expect(operatorClassStatement?.requires).toContainEqual({
      kind: "operator_family",
      schema: "public",
      name: "float_ops",
      signature: "(btree)",
    });
  });

  test("preserves external order-by operator families with built-in names", async () => {
    const result = await analyzeAndSort(
      [
        "set search_path = public, pg_catalog;",
        "create operator class app.score_ops for type app.score using gist as operator 1 <-> (app.score, app.score) for order by float_ops, function 1 app.score_consistent(internal, app.score, smallint, oid, internal);",
        "create operator <-> (function = app.score_distance, leftarg = app.score, rightarg = app.score);",
        "create function app.score_consistent(internal, app.score, smallint, oid, internal) returns bool language internal immutable strict as 'gbt_int4_consistent';",
        "create function app.score_distance(a app.score, b app.score) returns int4 language sql immutable strict as $$ select abs((a).value - (b).value) $$;",
        "create type app.score as (value int4);",
        "create schema app;",
      ],
      {
        externalProviders: [
          {
            kind: "operator_family",
            schema: "public",
            name: "float_ops",
            signature: "(btree)",
          },
        ],
      },
    );
    const missingFloatReturn = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "operator" &&
            ref.schema === "public" &&
            ref.name === "<->" &&
            ref.signature === "(app.score,app.score)->float8",
        ) === true,
    );

    expect(missingFloatReturn).toHaveLength(0);
  });

  test("preserves unqualified custom opclass support operators", async () => {
    const result = await analyzeAndSort([
      "set search_path = public, pg_catalog;",
      "create operator class app.score_ops for type int4 using btree as operator 1 < (int4, int4), function 1 btint4cmp(int4, int4);",
      "create operator < (function = app.score_lt, leftarg = int4, rightarg = int4);",
      "create function app.score_lt(a int4, b int4) returns boolean language sql immutable strict as $$ select a < b $$;",
      "create schema app;",
    ]);
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const operatorClassStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator class app.score_ops"),
    );

    expect(unresolvedCount).toBe(0);
    expect(operatorClassStatement?.requires).toContainEqual({
      kind: "operator",
      schema: "public",
      name: "<",
      signature: "(int4,int4)",
    });

    const validation = await validateAnalyzeResultWithPostgres(result);
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const operatorIndex = orderedSql.findIndex((sql) =>
      sql.includes("create operator <"),
    );
    const operatorClassIndex = orderedSql.findIndex((sql) =>
      sql.includes("create operator class app.score_ops"),
    );

    expect(executionErrors).toHaveLength(0);
    expect(operatorIndex).toBeGreaterThanOrEqual(0);
    expect(operatorClassIndex).toBeGreaterThan(operatorIndex);
  }, 120000);

  test("preserves local opclass support functions with built-in names", async () => {
    const result = await analyzeAndSort([
      "set search_path = public, pg_catalog;",
      "create operator class app.uuid_ops for type uuid using btree as function 1 uuid_cmp(uuid, uuid);",
      "create function uuid_cmp(a uuid, b uuid) returns int4 language sql immutable strict as $$ select pg_catalog.uuid_cmp(a, b) $$;",
      "create schema app;",
    ]);
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const operatorClassStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator class app.uuid_ops"),
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const supportFunctionIndex = orderedSql.findIndex((sql) =>
      sql.includes("create function uuid_cmp"),
    );
    const operatorClassIndex = orderedSql.findIndex((sql) =>
      sql.includes("create operator class app.uuid_ops"),
    );

    expect(unresolvedCount).toBe(0);
    expect(operatorClassStatement?.requires).toContainEqual({
      kind: "function",
      schema: "public",
      name: "uuid_cmp",
      signature: "(uuid,uuid)->int4",
    });
    expect(supportFunctionIndex).toBeGreaterThanOrEqual(0);
    expect(operatorClassIndex).toBeGreaterThan(supportFunctionIndex);
  });

  test("does not require producer statements for polymorphic built-in opclass support functions", async () => {
    const result = await analyzeAndSort([
      "create operator class app.mood_ops for type app.mood using btree as function 1 enum_cmp(app.mood, app.mood);",
      "create operator class app.score_array_ops for type app.score[] using btree as function 1 btarraycmp(app.score[], app.score[]);",
      "create type app.score as (value int4);",
      "create type app.mood as enum ('sad', 'ok');",
      "create schema app;",
    ]);
    const unresolved = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    );
    const moodOperatorClassStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator class app.mood_ops"),
    );
    const arrayOperatorClassStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator class app.score_array_ops"),
    );

    expect(unresolved).toHaveLength(0);
    expect(moodOperatorClassStatement?.requires).not.toContainEqual({
      kind: "function",
      schema: "public",
      name: "enum_cmp",
      signature: "(app.mood,app.mood)",
    });
    expect(arrayOperatorClassStatement?.requires).not.toContainEqual({
      kind: "function",
      schema: "public",
      name: "btarraycmp",
      signature: "(app.score[],app.score[])->int4",
    });
  });

  test("provides implicit operator families from operator classes", async () => {
    const result = await analyzeAndSort([
      "create operator class app.text_score_ops for type text using btree family app.score_ops as operator 1 < (text, text), operator 2 <= (text, text), operator 3 = (text, text), operator 4 >= (text, text), operator 5 > (text, text), function 1 bttextcmp(text, text);",
      "create operator class app.score_ops for type app.score using btree as operator 1 < (app.score, app.score), operator 2 <= (app.score, app.score), operator 3 = (app.score, app.score), operator 4 >= (app.score, app.score), operator 5 > (app.score, app.score), function 1 app.score_cmp(app.score, app.score);",
      "create function app.score_cmp(a app.score, b app.score) returns int4 language sql immutable strict as $$ select case when (a).value < (b).value then -1 when (a).value > (b).value then 1 else 0 end $$;",
      "create operator > (function = app.score_gt, leftarg = app.score, rightarg = app.score);",
      "create operator >= (function = app.score_gte, leftarg = app.score, rightarg = app.score);",
      "create operator = (function = app.score_eq, leftarg = app.score, rightarg = app.score);",
      "create operator <= (function = app.score_lte, leftarg = app.score, rightarg = app.score);",
      "create operator < (function = app.score_lt, leftarg = app.score, rightarg = app.score);",
      "create function app.score_gt(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value > (b).value $$;",
      "create function app.score_gte(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value >= (b).value $$;",
      "create function app.score_eq(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value = (b).value $$;",
      "create function app.score_lte(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value <= (b).value $$;",
      "create function app.score_lt(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value < (b).value $$;",
      "create type app.score as (value int4);",
      "create schema app;",
    ]);
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const providerStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator class app.score_ops"),
    );
    const consumerStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator class app.text_score_ops"),
    );

    expect(unresolvedCount).toBe(0);
    expect(providerStatement?.provides).toContainEqual({
      kind: "operator_family",
      schema: "app",
      name: "score_ops",
      signature: "(btree)",
    });
    expect(consumerStatement?.requires).toContainEqual({
      kind: "operator_family",
      schema: "app",
      name: "score_ops",
      signature: "(btree)",
    });

    const validation = await validateAnalyzeResultWithPostgres(result);
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const providerIndex = orderedSql.findIndex((sql) =>
      sql.includes("create operator class app.score_ops"),
    );
    const consumerIndex = orderedSql.findIndex((sql) =>
      sql.includes("create operator class app.text_score_ops"),
    );

    expect(executionErrors).toHaveLength(0);
    expect(providerIndex).toBeGreaterThanOrEqual(0);
    expect(consumerIndex).toBeGreaterThan(providerIndex);
  }, 120000);

  test("does not duplicate explicitly created implicit operator families", async () => {
    const result = await analyzeAndSort([
      "create operator class app.score_ops for type app.score using btree as operator 1 app.< (app.score, app.score), function 1 app.score_cmp(app.score, app.score);",
      "create operator family app.score_ops using btree;",
      "create operator app.< (function = app.score_lt, leftarg = app.score, rightarg = app.score);",
      "create function app.score_cmp(a app.score, b app.score) returns int4 language sql immutable strict as $$ select (a).value - (b).value $$;",
      "create function app.score_lt(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value < (b).value $$;",
      "create type app.score as (value int4);",
      "create schema app;",
    ]);
    const duplicateCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "DUPLICATE_PRODUCER",
    ).length;
    const operatorClassStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator class app.score_ops"),
    );
    const operatorFamilyStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator family app.score_ops"),
    );

    expect(duplicateCount).toBe(0);
    expect(operatorFamilyStatement?.provides).toContainEqual({
      kind: "operator_family",
      schema: "app",
      name: "score_ops",
      signature: "(btree)",
    });
    expect(operatorClassStatement?.provides).not.toContainEqual({
      kind: "operator_family",
      schema: "app",
      name: "score_ops",
      signature: "(btree)",
    });
    expect(operatorClassStatement?.requires).toContainEqual({
      kind: "operator_family",
      schema: "app",
      name: "score_ops",
      signature: "(btree)",
    });
  });

  test("uses opclass datatypes for omitted operator item arguments", async () => {
    const result = await analyzeAndSort([
      "create operator class app.score_ops for type app.score using btree as operator 1 app.<, function 1 app.score_cmp(app.score, app.score);",
      "create operator app.< (function = app.score_prefix, rightarg = app.score);",
      "create function app.score_cmp(a app.score, b app.score) returns int4 language sql immutable strict as $$ select case when (a).value < (b).value then -1 when (a).value > (b).value then 1 else 0 end $$;",
      "create function app.score_prefix(value app.score) returns bool language sql immutable strict as $$ select (value).value < 0 $$;",
      "create type app.score as (value int4);",
      "create schema app;",
    ]);
    const unresolvedOperatorDependency = result.diagnostics.find(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "operator" && ref.schema === "app" && ref.name === "<",
        ) === true,
    );
    const operatorClassStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator class app.score_ops"),
    );

    expect(operatorClassStatement?.requires).toContainEqual({
      kind: "operator",
      schema: "app",
      name: "<",
      signature: "(app.score,app.score)",
    });
    expect(unresolvedOperatorDependency?.objectRefs).toContainEqual({
      kind: "operator",
      schema: "app",
      name: "<",
      signature: "(app.score,app.score)",
    });
  }, 120000);

  test("records operator class storage type dependencies", async () => {
    const result = await analyzeAndSort([
      "create operator class app.score_ops for type app.score using btree as storage app.score_storage, operator 1 < (app.score, app.score), operator 2 <= (app.score, app.score), operator 3 = (app.score, app.score), operator 4 >= (app.score, app.score), operator 5 > (app.score, app.score), function 1 app.score_cmp(app.score, app.score);",
      "create function app.score_cmp(a app.score, b app.score) returns int4 language sql immutable strict as $$ select case when (a).value < (b).value then -1 when (a).value > (b).value then 1 else 0 end $$;",
      "create operator > (function = app.score_gt, leftarg = app.score, rightarg = app.score);",
      "create operator >= (function = app.score_gte, leftarg = app.score, rightarg = app.score);",
      "create operator = (function = app.score_eq, leftarg = app.score, rightarg = app.score);",
      "create operator <= (function = app.score_lte, leftarg = app.score, rightarg = app.score);",
      "create operator < (function = app.score_lt, leftarg = app.score, rightarg = app.score);",
      "create function app.score_gt(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value > (b).value $$;",
      "create function app.score_gte(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value >= (b).value $$;",
      "create function app.score_eq(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value = (b).value $$;",
      "create function app.score_lte(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value <= (b).value $$;",
      "create function app.score_lt(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value < (b).value $$;",
      "create type app.score_storage as (value int4);",
      "create type app.score as (value int4);",
      "create schema app;",
    ]);
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const operatorClassStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator class app.score_ops"),
    );

    expect(unresolvedCount).toBe(0);
    expect(operatorClassStatement?.requires).toContainEqual({
      kind: "type",
      schema: "app",
      name: "score_storage",
    });
  }, 120000);

  test("orders operator classes after support function op types", async () => {
    const result = await analyzeAndSort([
      "create operator class app.score_ops for type app.score using btree as operator 1 < (app.score, app.score), operator 2 <= (app.score, app.score), operator 3 = (app.score, app.score), operator 4 >= (app.score, app.score), operator 5 > (app.score, app.score), function 1 app.score_cmp(app.score, app.score), function 2 (app.other, app.other) app.score_sortsupport(internal);",
      "create function app.score_sortsupport(internal) returns void language internal immutable strict as 'btint4sortsupport';",
      "create function app.score_cmp(a app.score, b app.score) returns int4 language sql immutable strict as $$ select case when (a).value < (b).value then -1 when (a).value > (b).value then 1 else 0 end $$;",
      "create operator > (function = app.score_gt, leftarg = app.score, rightarg = app.score);",
      "create operator >= (function = app.score_gte, leftarg = app.score, rightarg = app.score);",
      "create operator = (function = app.score_eq, leftarg = app.score, rightarg = app.score);",
      "create operator <= (function = app.score_lte, leftarg = app.score, rightarg = app.score);",
      "create operator < (function = app.score_lt, leftarg = app.score, rightarg = app.score);",
      "create function app.score_gt(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value > (b).value $$;",
      "create function app.score_gte(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value >= (b).value $$;",
      "create function app.score_eq(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value = (b).value $$;",
      "create function app.score_lte(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value <= (b).value $$;",
      "create function app.score_lt(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value < (b).value $$;",
      "create type app.other as (value int4);",
      "create type app.score as (value int4);",
      "create schema app;",
    ]);
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const operatorClassStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator class app.score_ops"),
    );

    expect(unresolvedCount).toBe(0);
    expect(operatorClassStatement?.requires).toContainEqual({
      kind: "type",
      schema: "app",
      name: "other",
    });

    const validation = await validateAnalyzeResultWithPostgres(result);
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const opTypeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.other"),
    );
    const operatorClassIndex = orderedSql.findIndex((sql) =>
      sql.includes("create operator class app.score_ops"),
    );

    expect(executionErrors).toHaveLength(0);
    expect(opTypeIndex).toBeGreaterThanOrEqual(0);
    expect(operatorClassIndex).toBeGreaterThan(opTypeIndex);
  }, 120000);

  test("does not require producer statements for pg_catalog opclass support functions", async () => {
    const result = await analyzeAndSort([
      "create table app.measurements(id int primary key, value_span app.uuid_range not null);",
      "create type app.uuid_range as range (subtype = uuid, subtype_opclass = app.uuid_range_ops);",
      "create operator class app.uuid_range_ops for type uuid using btree as operator 1 < (uuid, uuid), operator 2 <= (uuid, uuid), operator 3 = (uuid, uuid), operator 4 >= (uuid, uuid), operator 5 > (uuid, uuid), function 1 uuid_cmp(uuid, uuid);",
      "create schema app;",
    ]);
    const validation = await validateAnalyzeResultWithPostgres(result);
    const unresolved = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    );
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const operatorClassStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator class app.uuid_range_ops"),
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const schemaIndex = orderedSql.findIndex((sql) =>
      sql.includes("create schema app"),
    );
    const operatorClassIndex = orderedSql.findIndex((sql) =>
      sql.includes("create operator class app.uuid_range_ops"),
    );
    const rangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.uuid_range"),
    );
    const tableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table app.measurements"),
    );

    expect(unresolved).toHaveLength(0);
    expect(operatorClassStatement?.requires).not.toContainEqual({
      kind: "function",
      schema: "public",
      name: "uuid_cmp",
      signature: "(uuid,uuid)->int4",
    });
    expect(executionErrors).toHaveLength(0);
    expect(schemaIndex).toBeGreaterThanOrEqual(0);
    expect(operatorClassIndex).toBeGreaterThan(schemaIndex);
    expect(rangeIndex).toBeGreaterThan(operatorClassIndex);
    expect(tableIndex).toBeGreaterThan(rangeIndex);
  }, 120000);

  test("does not treat range_cmp as built-in support for non-range scalar opclasses", async () => {
    const result = await analyzeAndSort([
      "create operator class app.score_ops for type app.score using btree as function 1 range_cmp(app.score, app.score);",
      "create type app.score as (value int4);",
      "create schema app;",
    ]);
    const unresolvedRangeCmp = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.name === "range_cmp" &&
            ref.signature === "(app.score,app.score)->int4",
        ) === true,
    );
    const operatorClassStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator class app.score_ops"),
    );

    expect(unresolvedRangeCmp.length).toBeGreaterThan(0);
    expect(operatorClassStatement?.requires).toContainEqual({
      kind: "function",
      schema: "public",
      name: "range_cmp",
      signature: "(app.score,app.score)->int4",
    });
  });

  test("does not require producers for pg_catalog hash opclass support functions", async () => {
    const result = await analyzeAndSort([
      "create operator class app.int4_hash_ops for type int4 using hash as operator 1 = (int4, int4), function 1 hashint4(int4);",
      "create schema app;",
    ]);
    const validation = await validateAnalyzeResultWithPostgres(result);
    const unresolved = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    );
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const operatorClassStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator class app.int4_hash_ops"),
    );

    expect(unresolved).toHaveLength(0);
    expect(operatorClassStatement?.requires).not.toContainEqual({
      kind: "function",
      schema: "public",
      name: "hashint4",
      signature: "(int4)->int4",
    });
    expect(executionErrors).toHaveLength(0);
  }, 120000);

  test("requires pg_catalog support functions in the matching access method slots", async () => {
    const result = await analyzeAndSort([
      "create operator class app.invalid_hash_as_btree_ops for type int4 using btree as operator 1 < (int4, int4), function 1 hashint4(int4), function 2 btint4cmp(int4, int4);",
      "create schema app;",
    ]);
    const hashFunctionInBtreeCompareSlot = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.schema === "public" &&
            ref.name === "hashint4" &&
            ref.signature === "(int4)->int4",
        ) === true,
    );
    const compareFunctionInBtreeSortSupportSlot = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.schema === "public" &&
            ref.name === "btint4cmp" &&
            ref.signature === "(int4,int4)->void",
        ) === true,
    );
    const operatorClassStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator class app.invalid_hash_as_btree_ops"),
    );

    expect(hashFunctionInBtreeCompareSlot).toHaveLength(1);
    expect(compareFunctionInBtreeSortSupportSlot).toHaveLength(1);
    expect(operatorClassStatement?.requires).toContainEqual({
      kind: "function",
      schema: "public",
      name: "hashint4",
      signature: "(int4)->int4",
    });
    expect(operatorClassStatement?.requires).toContainEqual({
      kind: "function",
      schema: "public",
      name: "btint4cmp",
      signature: "(int4,int4)->void",
    });
  });

  test("does not require producers for pg_catalog text hash support functions", async () => {
    const result = await analyzeAndSort([
      "create operator class app.text_hash_ops for type text using hash as operator 1 = (text, text), function 1 hashtext(text);",
      "create schema app;",
    ]);
    const validation = await validateAnalyzeResultWithPostgres(result);
    const unresolvedHashtext = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) => ref.kind === "function" && ref.name === "hashtext",
        ) === true,
    );
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const operatorClassStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator class app.text_hash_ops"),
    );

    expect(unresolvedHashtext).toHaveLength(0);
    expect(
      operatorClassStatement?.requires.some(
        (ref) => ref.kind === "function" && ref.name === "hashtext",
      ),
    ).toBe(false);
    expect(executionErrors).toHaveLength(0);
  }, 120000);

  test("diagnoses built-in support functions that mismatch opclass types", async () => {
    const result = await analyzeAndSort([
      "create operator class app.invalid_int4_hash_ops for type int4 using hash as operator 1 = (int4, int4), function 1 hashtext(text);",
      "create schema app;",
    ]);
    const invalidHashtext = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) => ref.kind === "function" && ref.name === "hashtext",
        ) === true,
    );
    const operatorClassStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator class app.invalid_int4_hash_ops"),
    );

    expect(invalidHashtext).toHaveLength(1);
    expect(
      operatorClassStatement?.requires.some(
        (ref) => ref.kind === "function" && ref.name === "hashtext",
      ),
    ).toBe(true);
  });

  test("does not require producers for pg_catalog enum and array support operators", async () => {
    const result = await analyzeAndSort([
      "create operator class app.mood_ops for type app.mood using btree as operator 1 < (app.mood, app.mood), operator 2 <= (app.mood, app.mood), operator 3 = (app.mood, app.mood), operator 4 >= (app.mood, app.mood), operator 5 > (app.mood, app.mood), function 1 enum_cmp(app.mood, app.mood);",
      "create operator class app.score_array_ops for type app.score[] using btree as operator 1 < (app.score[], app.score[]), operator 2 <= (app.score[], app.score[]), operator 3 = (app.score[], app.score[]), operator 4 >= (app.score[], app.score[]), operator 5 > (app.score[], app.score[]), function 1 btarraycmp(app.score[], app.score[]);",
      "create type app.score as (value int4);",
      "create type app.mood as enum ('sad', 'ok');",
      "create schema app;",
    ]);
    const validation = await validateAnalyzeResultWithPostgres(result);
    const unresolved = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    );
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const moodOperatorClassStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator class app.mood_ops"),
    );
    const arrayOperatorClassStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator class app.score_array_ops"),
    );

    expect(unresolved).toHaveLength(0);
    expect(moodOperatorClassStatement?.requires).not.toContainEqual({
      kind: "operator",
      schema: "public",
      name: "<",
      signature: "(app.mood,app.mood)",
    });
    expect(arrayOperatorClassStatement?.requires).not.toContainEqual({
      kind: "operator",
      schema: "public",
      name: "<",
      signature: "(app.score[],app.score[])",
    });
    expect(executionErrors).toHaveLength(0);
  }, 120000);

  test("does not require producers for unary pg_catalog operator callbacks", async () => {
    const result = await analyzeAndSort([
      "create operator app.- (function = int4um, rightarg = int4);",
      "create schema app;",
    ]);
    const validation = await validateAnalyzeResultWithPostgres(result);
    const unresolvedInt4um = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.name === "int4um" &&
            ref.signature === "(int4)",
        ) === true,
    );
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const operatorStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create operator app.-"),
    );

    expect(unresolvedInt4um).toHaveLength(0);
    expect(operatorStatement?.requires).not.toContainEqual({
      kind: "function",
      schema: "public",
      name: "int4um",
      signature: "(int4)",
    });
    expect(executionErrors).toHaveLength(0);
  }, 120000);

  test("does not require producer statements for built-in range operator classes", async () => {
    const result = await analyzeAndSort([
      "create table app.measurements(id int primary key, value_span app.int4_range not null);",
      "create type app.int4_range as range (subtype = int4, subtype_opclass = int4_ops);",
      "create schema app;",
    ]);
    const validation = await validateAnalyzeResultWithPostgres(result);
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const schemaIndex = orderedSql.findIndex((sql) =>
      sql.includes("create schema app"),
    );
    const rangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.int4_range"),
    );
    const tableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table app.measurements"),
    );

    expect(unresolvedCount).toBe(0);
    expect(executionErrors).toHaveLength(0);
    expect(schemaIndex).toBeGreaterThanOrEqual(0);
    expect(rangeIndex).toBeGreaterThan(schemaIndex);
    expect(tableIndex).toBeGreaterThan(rangeIndex);
  }, 120000);

  test("does not report missing default opclasses for pg_catalog polymorphic defaults", async () => {
    const result = await analyzeAndSort([
      "create table app.events(id int primary key, mood_span app.mood_range not null, mood_arrays app.mood_array_range not null, nested app.mood_nested_range not null);",
      "create type app.mood_nested_range as range (subtype = app.mood_range);",
      "create type app.mood_array_range as range (subtype = app.mood[]);",
      "create type app.mood_range as range (subtype = app.mood);",
      "create type app.mood as enum ('sad', 'ok');",
      "create schema app;",
    ]);
    const validation = await validateAnalyzeResultWithPostgres(result);
    const missingDefault = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.message.includes("No default btree operator class provider"),
    );
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );

    expect(missingDefault).toHaveLength(0);
    expect(executionErrors).toHaveLength(0);
  }, 120000);

  test("does not report missing default opclasses for domain range subtypes over built-ins", async () => {
    const result = await analyzeAndSort([
      "create type app.price_range as range (subtype = app.price);",
      "create domain app.price as numeric;",
      "create schema app;",
    ]);
    const validation = await validateAnalyzeResultWithPostgres(result);
    const missingDefault = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.message.includes(
          "No default btree operator class provider found for range subtype 'app.price'",
        ),
    );
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const domainIndex = orderedSql.findIndex((sql) =>
      sql.includes("create domain app.price"),
    );
    const rangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.price_range"),
    );

    expect(missingDefault).toHaveLength(0);
    expect(executionErrors).toHaveLength(0);
    expect(domainIndex).toBeGreaterThanOrEqual(0);
    expect(rangeIndex).toBeGreaterThan(domainIndex);
  }, 120000);

  test("does not require producer statements for pg_lsn range operator classes", async () => {
    const result = await analyzeAndSort([
      "create type app.lsn_range as range (subtype = pg_lsn, subtype_opclass = pg_lsn_ops);",
      "create schema app;",
    ]);
    const unresolved = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    );
    const rangeStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create type app.lsn_range"),
    );

    expect(unresolved).toHaveLength(0);
    expect(rangeStatement?.requires).not.toContainEqual({
      kind: "operator_class",
      schema: "public",
      name: "pg_lsn_ops",
      signature: "btree",
    });
  });

  test("does not require producer statements for built-in pattern range operator classes", async () => {
    const result = await analyzeAndSort([
      "create type app.label_range as range (subtype = text, subtype_opclass = text_pattern_ops);",
      "create type app.code_range as range (subtype = varchar, subtype_opclass = varchar_pattern_ops);",
      "create type app.fixed_code_range as range (subtype = bpchar, subtype_opclass = bpchar_pattern_ops);",
      "create schema app;",
    ]);
    const validation = await validateAnalyzeResultWithPostgres(result);
    const unresolved = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    );
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );

    expect(unresolved).toHaveLength(0);
    expect(executionErrors).toHaveLength(0);
  }, 120000);

  test("accepts explicit range opclasses with binary-coercible subtype inputs", async () => {
    const result = await analyzeAndSort([
      "create type app.varchar_range as range (subtype = varchar, subtype_opclass = pg_catalog.text_ops);",
      "create type app.cidr_range as range (subtype = cidr, subtype_opclass = pg_catalog.inet_ops);",
      "create schema app;",
    ]);
    const unresolved = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    );

    expect(unresolved).toHaveLength(0);

    const validation = await validateAnalyzeResultWithPostgres(result);
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );

    expect(executionErrors).toHaveLength(0);
  }, 120000);

  test("accepts explicit range opclasses through domain base types", async () => {
    const result = await analyzeAndSort([
      "create type app.price_range as range (subtype = app.price, subtype_opclass = numeric_ops);",
      "create domain app.price as numeric;",
      "create schema app;",
    ]);
    const validation = await validateAnalyzeResultWithPostgres(result);
    const unresolved = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    );
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const domainIndex = orderedSql.findIndex((sql) =>
      sql.includes("create domain app.price"),
    );
    const rangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.price_range"),
    );

    expect(unresolved).toHaveLength(0);
    expect(executionErrors).toHaveLength(0);
    expect(domainIndex).toBeGreaterThanOrEqual(0);
    expect(rangeIndex).toBeGreaterThan(domainIndex);
  }, 120000);

  test("uses public domain base types for omitted range opclasses", async () => {
    const result = await analyzeAndSort([
      "create type price_range as range (subtype = price);",
      "create domain price as numeric;",
    ]);
    const validation = await validateAnalyzeResultWithPostgres(result);
    const missingDefault = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.message.includes(
          "No default btree operator class provider found for range subtype 'price'",
        ),
    );
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const domainIndex = orderedSql.findIndex((sql) =>
      sql.includes("create domain price"),
    );
    const rangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type price_range"),
    );

    expect(missingDefault).toHaveLength(0);
    expect(executionErrors).toHaveLength(0);
    expect(domainIndex).toBeGreaterThanOrEqual(0);
    expect(rangeIndex).toBeGreaterThan(domainIndex);
  }, 120000);

  test("does not require producers for pg_catalog pattern support operators", async () => {
    const result = await analyzeAndSort([
      "create operator class app.text_pattern_ops for type text using btree as operator 1 ~<~ (text, text), operator 2 ~<=~ (text, text), operator 3 = (text, text), operator 4 ~>=~ (text, text), operator 5 ~>~ (text, text), function 1 bttext_pattern_cmp(text, text);",
      "create schema app;",
    ]);
    const validation = await validateAnalyzeResultWithPostgres(result);
    const unresolvedPatternOperators = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "operator" &&
            ref.schema === "public" &&
            ["~<~", "~<=~", "~>=~", "~>~"].includes(ref.name),
        ) === true,
    );
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );

    expect(unresolvedPatternOperators).toHaveLength(0);
    expect(executionErrors).toHaveLength(0);
  }, 120000);

  test("requires pg_catalog support operators in the matching access method slots", async () => {
    const result = await analyzeAndSort([
      "create operator class app.invalid_int4_hash_ops for type int4 using hash as operator 1 < (int4, int4), function 1 hashint4(int4);",
      "create schema app;",
    ]);
    const invalidHashOperator = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "operator" &&
            ref.schema === "public" &&
            ref.name === "<" &&
            ref.signature === "(int4,int4)",
        ) === true,
    );
    const operatorClassStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator class app.invalid_int4_hash_ops"),
    );

    expect(invalidHashOperator).toHaveLength(1);
    expect(operatorClassStatement?.requires).toContainEqual({
      kind: "operator",
      schema: "public",
      name: "<",
      signature: "(int4,int4)",
    });
  });

  test("does not require producers for built-in BRIN comparison support operators", async () => {
    const result = await analyzeAndSort([
      "create operator class app.int4_brin_ops for type int4 using brin as operator 1 < (int4, int4), operator 2 <= (int4, int4), operator 3 = (int4, int4), operator 4 >= (int4, int4), operator 5 > (int4, int4), function 1 brin_minmax_opcinfo(internal);",
      "create schema app;",
    ]);
    const validation = await validateAnalyzeResultWithPostgres(result);
    const unresolvedComparisonOperators = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "operator" &&
            ref.schema === "public" &&
            ["<", "<=", "=", ">=", ">"].includes(ref.name) &&
            ref.signature === "(int4,int4)",
        ) === true,
    );
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const operatorClassStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator class app.int4_brin_ops"),
    );

    expect(unresolvedComparisonOperators).toHaveLength(0);
    expect(operatorClassStatement?.requires).not.toContainEqual(
      expect.objectContaining({
        kind: "operator",
        schema: "public",
        signature: "(int4,int4)",
      }),
    );
    expect(executionErrors).toHaveLength(0);
  }, 120000);

  test("does not require producers for built-in BRIN bloom equality operators", async () => {
    const result = await analyzeAndSort([
      "create operator class app.int4_brin_bloom_ops for type int4 using brin as operator 1 = (int4, int4), function 1 brin_bloom_opcinfo(internal);",
      "create schema app;",
    ]);
    const validation = await validateAnalyzeResultWithPostgres(result);
    const unresolvedBloomEquality = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "operator" &&
            ref.schema === "public" &&
            ref.name === "=" &&
            ref.signature === "(int4,int4)",
        ) === true,
    );
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const operatorClassStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator class app.int4_brin_bloom_ops"),
    );

    expect(unresolvedBloomEquality).toHaveLength(0);
    expect(operatorClassStatement?.requires).not.toContainEqual({
      kind: "operator",
      schema: "public",
      name: "=",
      signature: "(int4,int4)",
    });
    expect(executionErrors).toHaveLength(0);
  }, 120000);

  test("requires built-in support operators only when PostgreSQL has the signature", async () => {
    const result = await analyzeAndSort([
      "create operator class app.point_ops for type point using btree as operator 1 < (point, point), function 1 app.point_cmp(point, point);",
      "create function app.point_cmp(a point, b point) returns int4 language sql immutable as $$ select 0 $$;",
      "create schema app;",
    ]);
    const unresolvedPointOperator = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "operator" &&
            ref.schema === "public" &&
            ref.name === "<" &&
            ref.signature === "(point,point)",
        ) === true,
    );
    const operatorClassStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator class app.point_ops"),
    );

    expect(unresolvedPointOperator).toHaveLength(1);
    expect(operatorClassStatement?.requires).toContainEqual({
      kind: "operator",
      schema: "public",
      name: "<",
      signature: "(point,point)",
    });
  });

  test("requires non-pattern support operators with pattern names", async () => {
    const result = await analyzeAndSort([
      "create operator class app.int4_pattern_ops for type int4 using btree as operator 1 ~<~ (int4, int4), function 1 btint4cmp(int4, int4);",
      "create schema app;",
    ]);
    const unresolvedPatternOperator = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "operator" &&
            ref.schema === "public" &&
            ref.name === "~<~" &&
            ref.signature === "(int4,int4)",
        ) === true,
    );

    expect(unresolvedPatternOperator).toHaveLength(1);
  });

  test("reports mixed built-in operator class support operator signatures", async () => {
    const result = await analyzeAndSort([
      "create operator class app.int4_ops for type int4 using btree as operator 1 < (int4, text), function 1 btint4cmp(int4, int4);",
      "create schema app;",
    ]);
    const mixedSignatureOperator = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "operator" &&
            ref.schema === "public" &&
            ref.name === "<" &&
            ref.signature === "(int4,text)",
        ) === true,
    );

    expect(mixedSignatureOperator).toHaveLength(1);
  });

  test("preserves local range opclasses with built-in names", async () => {
    const result = await analyzeAndSort([
      "set search_path = public, pg_catalog;",
      "create type app.int4_range as range (subtype = int4, subtype_opclass = int4_ops);",
      "create operator class int4_ops for type int4 using btree as operator 1 app.<# (int4, int4), function 1 app.int4_cmp(int4, int4);",
      "create operator app.<# (function = int4lt, leftarg = int4, rightarg = int4);",
      "create function app.int4_cmp(a int4, b int4) returns int4 language internal immutable strict as 'btint4cmp';",
      "create schema app;",
    ]);
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const rangeStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create type app.int4_range"),
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const operatorClassIndex = orderedSql.findIndex((sql) =>
      sql.includes("create operator class int4_ops"),
    );
    const rangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.int4_range"),
    );

    expect(unresolvedCount).toBe(0);
    expect(rangeStatement?.requires).toContainEqual({
      kind: "operator_class",
      schema: "public",
      name: "int4_ops",
      signature: "(btree,int4)",
    });
    expect(operatorClassIndex).toBeGreaterThanOrEqual(0);
    expect(rangeIndex).toBeGreaterThan(operatorClassIndex);
  });

  test("reports local range opclasses that shadow built-ins with incompatible subtypes", async () => {
    const result = await analyzeAndSort([
      "set search_path = public, pg_catalog;",
      "create type app.int4_range as range (subtype = int4, subtype_opclass = int4_ops);",
      "create operator class int4_ops for type text using btree as function 1 bttextcmp(text, text);",
      "create schema app;",
    ]);
    const missingInt4Opclass = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "operator_class" &&
            ref.schema === "public" &&
            ref.name === "int4_ops" &&
            ref.signature === "(btree,int4)",
        ) === true,
    );
    const rangeStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create type app.int4_range"),
    );

    expect(missingInt4Opclass).toHaveLength(1);
    expect(rangeStatement?.requires).toContainEqual({
      kind: "operator_class",
      schema: "public",
      name: "int4_ops",
      signature: "(btree,int4)",
    });
  });

  test("requires explicit range opclasses for the range subtype", async () => {
    const result = await analyzeAndSort([
      "create type app.r as range (subtype = int4, subtype_opclass = app.shared_ops);",
      "create operator class app.shared_ops for type text using btree as function 1 bttextcmp(text, text);",
      "create schema app;",
    ]);
    const missingInt4Opclass = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "operator_class" &&
            ref.schema === "app" &&
            ref.name === "shared_ops" &&
            ref.signature === "(btree,int4)",
        ) === true,
    );
    const rangeStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create type app.r"),
    );

    expect(rangeStatement?.requires).toContainEqual({
      kind: "operator_class",
      schema: "app",
      name: "shared_ops",
      signature: "(btree,int4)",
    });
    expect(missingInt4Opclass).toHaveLength(1);
  });

  test("reports pg_catalog range opclasses that do not match the subtype", async () => {
    const result = await analyzeAndSort([
      "create type app.r as range (subtype = int4, subtype_opclass = pg_catalog.text_ops);",
      "create schema app;",
    ]);
    const incompatibleOpclass = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "operator_class" &&
            ref.schema === "pg_catalog" &&
            ref.name === "text_ops" &&
            ref.signature === "(btree,int4)",
        ) === true,
    );

    expect(incompatibleOpclass).toHaveLength(1);
  });

  test("reports pg_catalog record range opclasses for non-record subtypes", async () => {
    const result = await analyzeAndSort([
      "create type app.r as range (subtype = int4, subtype_opclass = pg_catalog.record_ops);",
      "create schema app;",
    ]);
    const incompatibleOpclass = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "operator_class" &&
            ref.schema === "pg_catalog" &&
            ref.name === "record_ops" &&
            ref.signature === "(btree,int4)",
        ) === true,
    );

    expect(incompatibleOpclass).toHaveLength(1);
  });

  test("does not require producer statements for built-in range subtypes outside the core type list", async () => {
    const result = await analyzeAndSort([
      "create table app.networks(id int primary key, value_span app.mac_range not null);",
      "create type app.mac_range as range (subtype = macaddr8, subtype_opclass = macaddr8_ops);",
      "create schema app;",
    ]);
    const validation = await validateAnalyzeResultWithPostgres(result);
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const schemaIndex = orderedSql.findIndex((sql) =>
      sql.includes("create schema app"),
    );
    const rangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.mac_range"),
    );
    const tableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table app.networks"),
    );

    expect(unresolvedCount).toBe(0);
    expect(executionErrors).toHaveLength(0);
    expect(schemaIndex).toBeGreaterThanOrEqual(0);
    expect(rangeIndex).toBeGreaterThan(schemaIndex);
    expect(tableIndex).toBeGreaterThan(rangeIndex);
  }, 120000);

  test("does not report missing default opclasses for omitted built-in range subtypes outside the core type list", async () => {
    const result = await analyzeAndSort([
      "create table app.shifts(id int primary key, during app.timetz_range not null);",
      "create type app.timetz_range as range (subtype = timetz);",
      "create schema app;",
    ]);
    const missingDefault = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.message.includes("No default btree operator class provider"),
    );

    expect(missingDefault).toHaveLength(0);
  });

  test("does not require producer statements for built-in range collations", async () => {
    const cases = [
      {
        collationSql: '"default"',
        typeName: "default_label_range",
        tableName: "default_labels",
      },
      {
        collationSql: "ucs_basic",
        typeName: "ucs_basic_label_range",
        tableName: "ucs_basic_labels",
      },
      { collationSql: '"C"', typeName: "label_range", tableName: "labels" },
    ];

    const result = await analyzeAndSort([
      ...cases.flatMap((testCase) => [
        `create table app.${testCase.tableName}(id int primary key, value_span app.${testCase.typeName} not null);`,
        `create type app.${testCase.typeName} as range (subtype = text, collation = ${testCase.collationSql});`,
      ]),
      "create schema app;",
    ]);
    const unknownCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNKNOWN_STATEMENT_CLASS",
    ).length;
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;

    expect(unknownCount).toBe(0);
    expect(unresolvedCount).toBe(0);

    const validation = await validateAnalyzeResultWithPostgres(result);
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const schemaIndex = orderedSql.findIndex((sql) =>
      sql.includes("create schema app"),
    );

    expect(executionErrors).toHaveLength(0);
    expect(schemaIndex).toBeGreaterThanOrEqual(0);

    for (const testCase of cases) {
      const rangeIndex = orderedSql.findIndex((sql) =>
        sql.includes(`create type app.${testCase.typeName}`),
      );
      const tableIndex = orderedSql.findIndex((sql) =>
        sql.includes(`create table app.${testCase.tableName}`),
      );

      expect(rangeIndex).toBeGreaterThan(schemaIndex);
      expect(tableIndex).toBeGreaterThan(rangeIndex);
    }
  }, 120000);

  test("preserves local unqualified range collations with built-in names", async () => {
    const result = await analyzeAndSort([
      "set search_path = public, pg_catalog;",
      "create table app.labels(id int primary key, value_span app.label_range not null);",
      'create type app.label_range as range (subtype = text, collation = "C");',
      'create collation "C" from pg_catalog."C";',
      "create schema app;",
    ]);
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const rangeStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create type app.label_range"),
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const collationIndex = orderedSql.findIndex((sql) =>
      sql.includes('create collation "c"'),
    );
    const rangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.label_range"),
    );

    expect(unresolvedCount).toBe(0);
    expect(rangeStatement?.requires).toContainEqual({
      kind: "collation",
      schema: "public",
      name: "C",
    });
    expect(collationIndex).toBeGreaterThanOrEqual(0);
    expect(rangeIndex).toBeGreaterThan(collationIndex);
  });

  test("orders explicitly qualified public range collations before the range type", async () => {
    const result = await analyzeAndSort([
      "create table app.labels(id int primary key, value_span app.label_range not null);",
      'create type app.label_range as range (subtype = text, collation = public."C");',
      'create collation public."C" from pg_catalog."C";',
      "create schema app;",
    ]);
    const validation = await validateAnalyzeResultWithPostgres(result);
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const schemaIndex = orderedSql.findIndex((sql) =>
      sql.includes("create schema app"),
    );
    const collationIndex = orderedSql.findIndex((sql) =>
      sql.includes('create collation public."c"'),
    );
    const rangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.label_range"),
    );
    const tableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table app.labels"),
    );

    expect(unresolvedCount).toBe(0);
    expect(executionErrors).toHaveLength(0);
    expect(schemaIndex).toBeGreaterThanOrEqual(0);
    expect(collationIndex).toBeGreaterThanOrEqual(0);
    expect(rangeIndex).toBeGreaterThan(collationIndex);
    expect(tableIndex).toBeGreaterThan(rangeIndex);
  }, 120000);

  test("provides explicit multirange type names", async () => {
    const result = await analyzeAndSort([
      "create table app.labels(id int primary key, spans app.label_multirange not null);",
      "create type app.label_range as range (subtype = text, multirange_type_name = app.label_multirange);",
      "create schema app;",
    ]);
    const validation = await validateAnalyzeResultWithPostgres(result);
    const unknownCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNKNOWN_STATEMENT_CLASS",
    ).length;
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const schemaIndex = orderedSql.findIndex((sql) =>
      sql.includes("create schema app"),
    );
    const rangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.label_range"),
    );
    const tableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table app.labels"),
    );

    expect(unknownCount).toBe(0);
    expect(unresolvedCount).toBe(0);
    expect(executionErrors).toHaveLength(0);
    expect(schemaIndex).toBeGreaterThanOrEqual(0);
    expect(rangeIndex).toBeGreaterThan(schemaIndex);
    expect(tableIndex).toBeGreaterThan(rangeIndex);
  }, 120000);

  test("provides unqualified explicit multirange type names in the range schema", async () => {
    const result = await analyzeAndSort([
      "create table app.prices(id int primary key, spans app.price_multi not null);",
      "create type app.price_range as range (subtype = int4, multirange_type_name = price_multi);",
      "create schema app;",
    ]);
    const validation = await validateAnalyzeResultWithPostgres(result);
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const rangeStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create type app.price_range"),
    );
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const schemaIndex = orderedSql.findIndex((sql) =>
      sql.includes("create schema app"),
    );
    const rangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.price_range"),
    );
    const tableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table app.prices"),
    );

    expect(unresolvedCount).toBe(0);
    expect(rangeStatement?.provides).toContainEqual({
      kind: "type",
      schema: "app",
      name: "price_multi",
    });
    expect(executionErrors).toHaveLength(0);
    expect(schemaIndex).toBeGreaterThanOrEqual(0);
    expect(rangeIndex).toBeGreaterThan(schemaIndex);
    expect(tableIndex).toBeGreaterThan(rangeIndex);
  }, 120000);

  test("allows explicit multirange names when subtype matches the default multirange name", async () => {
    const result = await analyzeAndSort([
      "create type app.price_range as range (subtype = app.price_multirange, multirange_type_name = app.price_span);",
      "create domain app.price_multirange as numeric;",
      "create schema app;",
    ]);
    const selfSubtypeDiagnostics = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "type" &&
            ref.schema === "app" &&
            ref.name === "price_multirange",
        ) === true,
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const domainIndex = orderedSql.findIndex((sql) =>
      sql.includes("create domain app.price_multirange"),
    );
    const rangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.price_range"),
    );

    expect(selfSubtypeDiagnostics).toHaveLength(0);
    expect(domainIndex).toBeGreaterThanOrEqual(0);
    expect(rangeIndex).toBeGreaterThan(domainIndex);
  });

  test("provides implicit multirange type names", async () => {
    const result = await analyzeAndSort([
      "create table app.prices(id int primary key, spans app.price_multirange not null);",
      "create type app.price_range as range (subtype = int4);",
      "create schema app;",
    ]);
    const validation = await validateAnalyzeResultWithPostgres(result);
    const unknownCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNKNOWN_STATEMENT_CLASS",
    ).length;
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const schemaIndex = orderedSql.findIndex((sql) =>
      sql.includes("create schema app"),
    );
    const rangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.price_range"),
    );
    const tableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table app.prices"),
    );

    expect(unknownCount).toBe(0);
    expect(unresolvedCount).toBe(0);
    expect(executionErrors).toHaveLength(0);
    expect(schemaIndex).toBeGreaterThanOrEqual(0);
    expect(rangeIndex).toBeGreaterThan(schemaIndex);
    expect(tableIndex).toBeGreaterThan(rangeIndex);
  }, 120000);

  test("clips implicit multirange type names to PostgreSQL identifier length", async () => {
    const rangeTypeName =
      "ledger_transaction_identifier_bucket_token_history_segmentalpha";
    const multirangeTypeName =
      "ledger_transaction_identifier_bucket_token_history_s_multirange";
    const result = await analyzeAndSort([
      `create table app.ledger_events(id int primary key, spans app.${multirangeTypeName} not null);`,
      `create type app.${rangeTypeName} as range (subtype = int4);`,
      "create schema app;",
    ]);
    const unresolved = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    );
    const rangeStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes(`create type app.${rangeTypeName}`),
    );

    expect(unresolved).toHaveLength(0);
    expect(rangeStatement?.provides).toContainEqual({
      kind: "type",
      schema: "app",
      name: multirangeTypeName,
    });
  });

  test("uses PostgreSQL default multirange names for embedded range substrings", async () => {
    const result = await analyzeAndSort([
      "create table app.time_buckets(id int primary key, spans app.timemultirange_bucket not null);",
      "create type app.timerange_bucket as range (subtype = time);",
      "create schema app;",
    ]);
    const validation = await validateAnalyzeResultWithPostgres(result);
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const schemaIndex = orderedSql.findIndex((sql) =>
      sql.includes("create schema app"),
    );
    const rangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.timerange_bucket"),
    );
    const tableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table app.time_buckets"),
    );

    expect(unresolvedCount).toBe(0);
    expect(executionErrors).toHaveLength(0);
    expect(schemaIndex).toBeGreaterThanOrEqual(0);
    expect(rangeIndex).toBeGreaterThan(schemaIndex);
    expect(tableIndex).toBeGreaterThan(rangeIndex);
  }, 120000);

  test("provides array refs for explicit and implicit multirange type names", async () => {
    const result = await analyzeAndSort([
      "create table app.labels(id int primary key, spans app.label_multirange[] not null);",
      "create table app.prices(id int primary key, spans app.price_multirange[] not null);",
      "create type app.label_range as range (subtype = text, multirange_type_name = app.label_multirange);",
      "create type app.price_range as range (subtype = int4);",
      "create schema app;",
    ]);
    const validation = await validateAnalyzeResultWithPostgres(result);
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const explicitRangeStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create type app.label_range"),
    );
    const implicitRangeStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create type app.price_range"),
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const explicitRangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.label_range"),
    );
    const implicitRangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.price_range"),
    );
    const labelsTableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table app.labels"),
    );
    const pricesTableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table app.prices"),
    );

    expect(unresolvedCount).toBe(0);
    expect(executionErrors).toHaveLength(0);
    expect(explicitRangeStatement?.provides).toContainEqual({
      kind: "type",
      schema: "app",
      name: "label_multirange[]",
    });
    expect(implicitRangeStatement?.provides).toContainEqual({
      kind: "type",
      schema: "app",
      name: "price_multirange[]",
    });
    expect(labelsTableIndex).toBeGreaterThan(explicitRangeIndex);
    expect(pricesTableIndex).toBeGreaterThan(implicitRangeIndex);
  }, 120000);

  test("provides array refs for composite and table row types", async () => {
    const result = await analyzeAndSort([
      "create table app.events(id int primary key, emails app.email[] not null, rows app.row_type[] not null, sources app.source_table[] not null, view_rows app.source_view[] not null, materialized_rows app.source_mat_view[] not null);",
      "create domain app.email as text;",
      "create type app.row_type as (value int4);",
      "create table app.source_table(id int primary key);",
      "create view app.source_view as select id from app.source_table;",
      "create materialized view app.source_mat_view as select id from app.source_table;",
      "create schema app;",
    ]);
    const validation = await validateAnalyzeResultWithPostgres(result);
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const compositeStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create type app.row_type"),
    );
    const domainStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create domain app.email"),
    );
    const sourceTableStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create table app.source_table"),
    );
    const sourceViewStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create view app.source_view"),
    );
    const sourceMatViewStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create materialized view app.source_mat_view"),
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const compositeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.row_type"),
    );
    const domainIndex = orderedSql.findIndex((sql) =>
      sql.includes("create domain app.email"),
    );
    const sourceTableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table app.source_table"),
    );
    const sourceViewIndex = orderedSql.findIndex((sql) =>
      sql.includes("create view app.source_view"),
    );
    const sourceMatViewIndex = orderedSql.findIndex((sql) =>
      sql.includes("create materialized view app.source_mat_view"),
    );
    const eventsTableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table app.events"),
    );

    expect(unresolvedCount).toBe(0);
    expect(executionErrors).toHaveLength(0);
    expect(compositeStatement?.provides).toContainEqual({
      kind: "type",
      schema: "app",
      name: "row_type[]",
    });
    expect(domainStatement?.provides).toContainEqual({
      kind: "type",
      schema: "app",
      name: "email[]",
    });
    expect(sourceTableStatement?.provides).toContainEqual({
      kind: "type",
      schema: "app",
      name: "source_table[]",
    });
    expect(sourceViewStatement?.provides).toContainEqual({
      kind: "type",
      schema: "app",
      name: "source_view[]",
    });
    expect(sourceMatViewStatement?.provides).toContainEqual({
      kind: "type",
      schema: "app",
      name: "source_mat_view[]",
    });
    expect(compositeIndex).toBeGreaterThanOrEqual(0);
    expect(domainIndex).toBeGreaterThan(compositeIndex);
    expect(sourceTableIndex).toBeGreaterThan(compositeIndex);
    expect(sourceViewIndex).toBeGreaterThan(sourceTableIndex);
    expect(sourceMatViewIndex).toBeGreaterThan(sourceTableIndex);
    expect(eventsTableIndex).toBeGreaterThan(domainIndex);
    expect(eventsTableIndex).toBeGreaterThan(sourceTableIndex);
    expect(eventsTableIndex).toBeGreaterThan(sourceViewIndex);
    expect(eventsTableIndex).toBeGreaterThan(sourceMatViewIndex);
  }, 120000);

  test("orders canonical range functions through the shell type pattern", async () => {
    const result = await analyzeAndSort([
      "create table app.events(id int primary key, during app.int_range not null);",
      "create type app.int_range as range (subtype = int4, canonical = app.int_range_canonical);",
      "create function app.int_range_canonical(value app.int_range) returns app.int_range language internal immutable as 'int4range_canonical';",
      "create type app.int_range;",
      "create schema app;",
    ]);
    const validation = await validateAnalyzeResultWithPostgres(result);
    const unknownCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNKNOWN_STATEMENT_CLASS",
    ).length;
    const duplicateCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "DUPLICATE_PRODUCER",
    ).length;
    const cycleCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "CYCLE_DETECTED",
    ).length;
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const schemaIndex = orderedSql.findIndex((sql) =>
      sql.includes("create schema app"),
    );
    const shellTypeIndex = orderedSql.findIndex(
      (sql) => sql.trim() === "create type app.int_range;",
    );
    const canonicalIndex = orderedSql.findIndex((sql) =>
      sql.includes("create function app.int_range_canonical"),
    );
    const rangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.int_range as range"),
    );
    const tableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table app.events"),
    );

    expect(unknownCount).toBe(0);
    expect(duplicateCount).toBe(0);
    expect(cycleCount).toBe(0);
    expect(executionErrors).toHaveLength(0);
    expect(schemaIndex).toBeGreaterThanOrEqual(0);
    expect(shellTypeIndex).toBeGreaterThan(schemaIndex);
    expect(canonicalIndex).toBeGreaterThan(shellTypeIndex);
    expect(rangeIndex).toBeGreaterThan(canonicalIndex);
    expect(tableIndex).toBeGreaterThan(rangeIndex);
  }, 120000);

  test("orders concrete range types after their shell definitions", async () => {
    const result = await analyzeAndSort([
      "create table app.events(id int primary key, during app.int_range not null);",
      "create type app.int_range as range (subtype = int4);",
      "create type app.int_range;",
      "create schema app;",
    ]);
    const validation = await validateAnalyzeResultWithPostgres(result);
    const duplicateCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "DUPLICATE_PRODUCER",
    ).length;
    const cycleCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "CYCLE_DETECTED",
    ).length;
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const schemaIndex = orderedSql.findIndex((sql) =>
      sql.includes("create schema app"),
    );
    const shellTypeIndex = orderedSql.findIndex(
      (sql) => sql.trim() === "create type app.int_range;",
    );
    const rangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.int_range as range"),
    );
    const tableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table app.events"),
    );

    expect(duplicateCount).toBe(0);
    expect(cycleCount).toBe(0);
    expect(executionErrors).toHaveLength(0);
    expect(schemaIndex).toBeGreaterThanOrEqual(0);
    expect(shellTypeIndex).toBeGreaterThan(schemaIndex);
    expect(rangeIndex).toBeGreaterThan(shellTypeIndex);
    expect(tableIndex).toBeGreaterThan(rangeIndex);
  }, 120000);

  test("orders unqualified public canonical range functions through shell types", async () => {
    const result = await analyzeAndSort([
      "create table events(id int primary key, during int_range not null);",
      "create type int_range as range (subtype = int4, canonical = int_range_canonical);",
      "create function int_range_canonical(value int_range) returns int_range language internal immutable as 'int4range_canonical';",
      "create type int_range;",
    ]);
    const validation = await validateAnalyzeResultWithPostgres(result);
    const cycleCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "CYCLE_DETECTED",
    ).length;
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const shellTypeIndex = orderedSql.findIndex(
      (sql) => sql.trim() === "create type int_range;",
    );
    const canonicalIndex = orderedSql.findIndex((sql) =>
      sql.includes("create function int_range_canonical"),
    );
    const rangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type int_range as range"),
    );
    const tableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table events"),
    );

    expect(cycleCount).toBe(0);
    expect(executionErrors).toHaveLength(0);
    expect(shellTypeIndex).toBeGreaterThanOrEqual(0);
    expect(canonicalIndex).toBeGreaterThan(shellTypeIndex);
    expect(rangeIndex).toBeGreaterThan(canonicalIndex);
    expect(tableIndex).toBeGreaterThan(rangeIndex);
  }, 120000);

  test("preserves concrete providers for base type definitions", async () => {
    const result = await analyzeAndSort([
      "create table app.items(id int primary key, value app.widget not null);",
      "create type app.widget (input = app.widget_in, output = app.widget_out, internallength = 4, passedbyvalue, alignment = int4);",
      "create function app.widget_out(value app.widget) returns cstring language internal immutable strict as 'int4out';",
      "create function app.widget_in(value cstring) returns app.widget language internal immutable strict as 'int4in';",
      "create type app.widget;",
      "create schema app;",
    ]);
    const validation = await validateAnalyzeResultWithPostgres(result);
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const duplicateCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "DUPLICATE_PRODUCER",
    ).length;
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const schemaIndex = orderedSql.findIndex((sql) =>
      sql.includes("create schema app"),
    );
    const shellTypeIndex = orderedSql.findIndex(
      (sql) => sql.trim() === "create type app.widget;",
    );
    const inputFunctionIndex = orderedSql.findIndex((sql) =>
      sql.includes("create function app.widget_in"),
    );
    const outputFunctionIndex = orderedSql.findIndex((sql) =>
      sql.includes("create function app.widget_out"),
    );
    const baseTypeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.widget ("),
    );
    const tableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table app.items"),
    );

    expect(unresolvedCount).toBe(0);
    expect(duplicateCount).toBe(0);
    expect(executionErrors).toHaveLength(0);
    expect(schemaIndex).toBeGreaterThanOrEqual(0);
    expect(shellTypeIndex).toBeGreaterThan(schemaIndex);
    expect(inputFunctionIndex).toBeGreaterThan(shellTypeIndex);
    expect(outputFunctionIndex).toBeGreaterThan(shellTypeIndex);
    expect(baseTypeIndex).toBeGreaterThan(inputFunctionIndex);
    expect(baseTypeIndex).toBeGreaterThan(outputFunctionIndex);
    expect(tableIndex).toBeGreaterThan(baseTypeIndex);
  }, 120000);

  test("orders base types after types referenced by LIKE", async () => {
    const result = await analyzeAndSort([
      "create table app.items(id int primary key, value app.child_widget not null);",
      "create type app.child_widget (input = app.child_widget_in, output = app.child_widget_out, like = app.parent_widget);",
      "create function app.child_widget_out(value app.child_widget) returns cstring language internal immutable strict as 'int4out';",
      "create function app.child_widget_in(value cstring) returns app.child_widget language internal immutable strict as 'int4in';",
      "create type app.child_widget;",
      "create type app.parent_widget (input = app.parent_widget_in, output = app.parent_widget_out, internallength = 4, passedbyvalue, alignment = int4);",
      "create function app.parent_widget_out(value app.parent_widget) returns cstring language internal immutable strict as 'int4out';",
      "create function app.parent_widget_in(value cstring) returns app.parent_widget language internal immutable strict as 'int4in';",
      "create type app.parent_widget;",
      "create schema app;",
    ]);
    const validation = await validateAnalyzeResultWithPostgres(result);
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const parentBaseTypeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.parent_widget ("),
    );
    const childBaseTypeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.child_widget ("),
    );
    const tableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table app.items"),
    );

    expect(unresolvedCount).toBe(0);
    expect(executionErrors).toHaveLength(0);
    expect(parentBaseTypeIndex).toBeGreaterThanOrEqual(0);
    expect(childBaseTypeIndex).toBeGreaterThan(parentBaseTypeIndex);
    expect(tableIndex).toBeGreaterThan(childBaseTypeIndex);
  }, 120000);

  test("orders base types after element types", async () => {
    const result = await analyzeAndSort([
      "create table app.items(id int primary key, value app.widget not null);",
      "create type app.widget (input = app.widget_in, output = app.widget_out, element = app.elem, internallength = 4, alignment = int4);",
      "create function app.widget_out(value app.widget) returns cstring language internal immutable strict as 'int4out';",
      "create function app.widget_in(value cstring) returns app.widget language internal immutable strict as 'int4in';",
      "create type app.elem as (value int4);",
      "create type app.widget;",
      "create schema app;",
    ]);
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const baseTypeStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create type app.widget ("),
    );

    expect(unresolvedCount).toBe(0);
    expect(baseTypeStatement?.requires).toContainEqual({
      kind: "type",
      schema: "app",
      name: "elem",
    });

    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const elementTypeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.elem"),
    );
    const baseTypeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.widget ("),
    );

    expect(elementTypeIndex).toBeGreaterThanOrEqual(0);
    expect(baseTypeIndex).toBeGreaterThan(elementTypeIndex);
  }, 120000);

  test("requires base type support functions with PostgreSQL signatures", async () => {
    const result = await analyzeAndSort([
      "create type app.score (input = app.score_in, output = app.score_out, internallength = 4, alignment = int4);",
      "create function app.score_out(value app.score) returns cstring language internal immutable strict as 'int4out';",
      "create function app.score_in(value int4) returns app.score language sql immutable strict as $$ select null::app.score $$;",
      "create type app.score;",
      "create schema app;",
    ]);
    const unresolved = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    );
    const baseTypeStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create type app.score ("),
    );

    expect(unresolved).toHaveLength(1);
    expect(baseTypeStatement?.requires).toContainEqual({
      kind: "function",
      schema: "app",
      name: "score_in",
      signature: "(cstring)->app.score",
    });
    expect(baseTypeStatement?.requires).toContainEqual({
      kind: "function",
      schema: "app",
      name: "score_out",
      signature: "(app.score)->cstring",
    });
  });

  test("does not satisfy exact base type callbacks with shorter overloads", async () => {
    const result = await analyzeAndSort([
      "create type app.widget (input = app.widget_in, output = app.widget_out, internallength = 4, alignment = int4);",
      "create function app.widget_out(value app.widget) returns cstring language internal immutable strict as 'int4out';",
      "create function app.widget_in(value cstring, extra int4 default 0) returns app.widget language internal immutable strict as 'int4in';",
      "create type app.widget;",
      "create schema app;",
    ]);
    const unresolvedInputFunction = result.diagnostics.find(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.schema === "app" &&
            ref.name === "widget_in",
        ) === true,
    );
    const baseTypeStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create type app.widget ("),
    );

    expect(baseTypeStatement?.requires).toContainEqual({
      kind: "function",
      schema: "app",
      name: "widget_in",
      signature: "(cstring)->app.widget",
    });
    expect(unresolvedInputFunction?.objectRefs).toContainEqual({
      kind: "function",
      schema: "app",
      name: "widget_in",
      signature: "(cstring)->app.widget",
    });
  });

  test("accepts three-argument base type input callbacks", async () => {
    const result = await analyzeAndSort([
      "create type app.widget (input = app.widget_in, output = app.widget_out, internallength = 4, alignment = int4);",
      "create function app.widget_out(value app.widget) returns cstring language internal immutable strict as 'int4out';",
      "create function app.widget_in(value cstring, type_oid oid, typmod int4) returns app.widget language internal immutable strict as 'int4in';",
      "create type app.widget;",
      "create schema app;",
    ]);
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const baseTypeStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create type app.widget ("),
    );

    expect(unresolvedCount).toBe(0);
    expect(baseTypeStatement?.requires).toContainEqual({
      kind: "function",
      schema: "app",
      name: "widget_in",
      signature: "(cstring,oid,int4)->app.widget",
    });
  });

  test("accepts three-argument base type receive callbacks", async () => {
    const result = await analyzeAndSort([
      "create type app.widget (input = app.widget_in, output = app.widget_out, receive = app.widget_recv, send = app.widget_send, internallength = 4, alignment = int4);",
      "create function app.widget_send(value app.widget) returns bytea language internal immutable strict as 'int4send';",
      "create function app.widget_recv(value internal, type_oid oid, typmod int4) returns app.widget language internal immutable strict as 'int4recv';",
      "create function app.widget_out(value app.widget) returns cstring language internal immutable strict as 'int4out';",
      "create function app.widget_in(value cstring) returns app.widget language internal immutable strict as 'int4in';",
      "create type app.widget;",
      "create schema app;",
    ]);
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const baseTypeStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create type app.widget ("),
    );

    expect(unresolvedCount).toBe(0);
    expect(baseTypeStatement?.requires).toContainEqual({
      kind: "function",
      schema: "app",
      name: "widget_recv",
      signature: "(internal,oid,int4)->app.widget",
    });
  });

  test("does not require producers for unqualified built-in base type callbacks", async () => {
    const result = await analyzeAndSort([
      "create type app.widget (input = app.widget_in, output = app.widget_out, analyze = array_typanalyze, subscript = array_subscript_handler, internallength = 4, alignment = int4);",
      "create function app.widget_out(value app.widget) returns cstring language internal immutable strict as 'int4out';",
      "create function app.widget_in(value cstring) returns app.widget language internal immutable strict as 'int4in';",
      "create type app.widget;",
      "create schema app;",
    ]);
    const unresolvedBuiltInCallbacks = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.schema === "public" &&
            ["array_typanalyze", "array_subscript_handler"].includes(
              ref.name,
            ) &&
            ref.signature === "(internal)",
        ) === true,
    );
    const baseTypeStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create type app.widget ("),
    );

    expect(unresolvedBuiltInCallbacks).toHaveLength(0);
    expect(baseTypeStatement?.requires).not.toContainEqual(
      expect.objectContaining({
        kind: "function",
        schema: "public",
        signature: "(internal)->bool",
      }),
    );
  });

  test("preserves schema-qualified base type callbacks with built-in names", async () => {
    const result = await analyzeAndSort([
      "create type app.widget (input = app.widget_in, output = app.widget_out, analyze = public.array_typanalyze, internallength = 4, alignment = int4);",
      "create function app.widget_out(value app.widget) returns cstring language internal immutable strict as 'int4out';",
      "create function app.widget_in(value cstring) returns app.widget language internal immutable strict as 'int4in';",
      "create type app.widget;",
      "create schema app;",
    ]);
    const localCallback = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.schema === "public" &&
            ref.name === "array_typanalyze" &&
            ref.signature === "(internal)->bool",
        ) === true,
    );
    const baseTypeStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create type app.widget ("),
    );

    expect(localCallback).toHaveLength(1);
    expect(
      baseTypeStatement?.requires.some(
        (ref) =>
          ref.kind === "function" &&
          ref.schema === "public" &&
          ref.name === "array_typanalyze" &&
          ref.signature === "(internal)->bool" &&
          ref.exactKind === true &&
          ref.exactSignature === true,
      ),
    ).toBe(true);
  });

  test("diagnoses unknown pg_catalog base type callbacks", async () => {
    const result = await analyzeAndSort([
      "create type app.widget (input = pg_catalog.no_such_in, output = app.widget_out, internallength = 4, alignment = int4);",
      "create function app.widget_out(value app.widget) returns cstring language internal immutable strict as 'int4out';",
      "create type app.widget;",
      "create schema app;",
    ]);
    const unknownCallback = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.schema === "pg_catalog" &&
            ref.name === "no_such_in" &&
            (ref.signature === "(cstring)->app.widget" ||
              ref.signature === "(cstring,oid,int4)->app.widget"),
        ) === true,
    );

    expect(unknownCallback.length).toBeGreaterThan(0);
  });

  test("diagnoses unknown pg_catalog base type option types", async () => {
    const result = await analyzeAndSort([
      "create type app.widget (input = app.widget_in, output = app.widget_out, like = pg_catalog.no_such, element = pg_catalog.no_such_element, internallength = 4, alignment = int4);",
      "create function app.widget_in(value cstring) returns app.widget language internal immutable strict as 'int4in';",
      "create function app.widget_out(value app.widget) returns cstring language internal immutable strict as 'int4out';",
      "create type app.widget;",
      "create schema app;",
    ]);
    const missingLike = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "type" &&
            ref.schema === "pg_catalog" &&
            ref.name === "no_such",
        ) === true,
    );
    const missingElement = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "type" &&
            ref.schema === "pg_catalog" &&
            ref.name === "no_such_element",
        ) === true,
    );

    expect(missingLike).toHaveLength(1);
    expect(missingElement).toHaveLength(1);
  });

  test("does not require producer statements for built-in operator implementation functions", async () => {
    const result = await analyzeAndSort([
      "create operator app.=== (function = texteq, leftarg = text, rightarg = text);",
      "create schema app;",
    ]);
    const validation = await validateAnalyzeResultWithPostgres(result);
    const unresolved = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    );
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const operatorStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create operator app.==="),
    );

    expect(unresolved).toHaveLength(0);
    expect(operatorStatement?.requires).not.toContainEqual({
      kind: "function",
      schema: "public",
      name: "texteq",
      signature: "(text,text)",
    });
    expect(executionErrors).toHaveLength(0);
  }, 120000);

  test("preserves local operator implementation functions with built-in names", async () => {
    const result = await analyzeAndSort([
      "create operator public.=== (function = texteq, leftarg = text, rightarg = text);",
      "create function public.texteq(a text, b text) returns boolean language sql immutable strict as $$ select a operator(pg_catalog.=) b $$;",
    ]);
    const unresolved = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    );
    const operatorStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create operator public.==="),
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const functionIndex = orderedSql.findIndex((sql) =>
      sql.includes("create function public.texteq"),
    );
    const operatorIndex = orderedSql.findIndex((sql) =>
      sql.includes("create operator public.==="),
    );

    expect(unresolved).toHaveLength(0);
    expect(operatorStatement?.requires).toContainEqual(
      expect.objectContaining({
        kind: "function",
        schema: "public",
        name: "texteq",
      }),
    );
    expect(functionIndex).toBeGreaterThanOrEqual(0);
    expect(operatorIndex).toBeGreaterThan(functionIndex);
  });

  test("preserves local operator estimator functions with built-in names", async () => {
    const result = await analyzeAndSort([
      "create operator public.=== (function = texteq, leftarg = text, rightarg = text, restrict = eqsel);",
      "create function public.eqsel(internal, oid, internal, integer) returns float8 language internal stable strict as 'eqsel';",
    ]);
    const unresolved = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    );
    const operatorStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create operator public.==="),
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const functionIndex = orderedSql.findIndex((sql) =>
      sql.includes("create function public.eqsel"),
    );
    const operatorIndex = orderedSql.findIndex((sql) =>
      sql.includes("create operator public.==="),
    );

    expect(unresolved).toHaveLength(0);
    expect(operatorStatement?.requires).toContainEqual(
      expect.objectContaining({
        kind: "function",
        schema: "public",
        name: "eqsel",
        signature: "(internal,oid,internal,int4)->float8",
      }),
    );
    expect(functionIndex).toBeGreaterThanOrEqual(0);
    expect(operatorIndex).toBeGreaterThan(functionIndex);
  });

  test("reports missing default range subtype operator class providers", async () => {
    const result = await analyzeAndSort([
      "create type app.score_range as range (subtype = app.score);",
      "create type app.score as (value int4);",
      "create schema app;",
    ]);
    const missingDefaultOpclass = result.diagnostics.find(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.message.includes(
          "default btree operator class provider found for range subtype 'app.score'",
        ),
    );

    expect(missingDefaultOpclass?.objectRefs).toContainEqual({
      kind: "type",
      schema: "app",
      name: "score",
    });
  });

  test("reports missing default range opclasses for built-in subtypes without defaults", async () => {
    const result = await analyzeAndSort([
      "create type app.point_range as range (subtype = point);",
      "create schema app;",
    ]);
    const missingDefaultOpclass = result.diagnostics.find(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.message.includes(
          "default btree operator class provider found for range subtype",
        ),
    );

    expect(missingDefaultOpclass?.objectRefs).toContainEqual({
      kind: "type",
      schema: "public",
      name: "point",
    });
  });

  test("does not require producer statements for remaining built-in btree range opclasses", async () => {
    const result = await analyzeAndSort([
      "create type app.tx_range as range (subtype = xid8);",
      "create type app.tid_range as range (subtype = tid, subtype_opclass = tid_ops);",
      "create type app.oidvector_range as range (subtype = oidvector, subtype_opclass = oidvector_ops);",
      "create schema app;",
    ]);
    const unresolved = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    );

    expect(unresolved).toHaveLength(0);
  });

  test("diagnoses invalid pg_catalog operator class support routines", async () => {
    const result = await analyzeAndSort([
      "create operator class app.bad_int4_ops for type int4 using btree as operator 1 < (int4, int4), function 1 pg_catalog.hashint4(int4);",
      "create schema app;",
    ]);
    const invalidSupportRoutine = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.schema === "pg_catalog" &&
            ref.name === "hashint4" &&
            ref.signature === "(int4)->int4",
        ) === true,
    );

    expect(invalidSupportRoutine).toHaveLength(1);
  });

  test("diagnoses invalid qualified operator implementation callbacks", async () => {
    const result = await analyzeAndSort([
      "create operator app.<< (function = pg_catalog.date_lt, leftarg = int4, rightarg = int4);",
      "create schema app;",
    ]);
    const invalidImplementation = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.schema === "pg_catalog" &&
            ref.name === "date_lt" &&
            ref.signature === "(pg_catalog.int4,pg_catalog.int4)",
        ) === true,
    );

    expect(invalidImplementation).toHaveLength(1);
  });

  test("diagnoses invalid qualified operator class support operators", async () => {
    const result = await analyzeAndSort([
      "create operator class app.invalid_int4_hash_ops for type int4 using hash as operator 1 pg_catalog.< (int4, int4), function 1 hashint4(int4);",
      "create schema app;",
    ]);
    const invalidSupportOperator = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "operator" &&
            ref.schema === "pg_catalog" &&
            ref.name === "<" &&
            ref.signature === "(int4,int4)",
        ) === true,
    );

    expect(invalidSupportOperator).toHaveLength(1);
  });

  test("accepts binary-compatible local range opclasses", async () => {
    const result = await analyzeAndSort([
      "create type app.varchar_range as range (subtype = varchar, subtype_opclass = app.text_ops);",
      "create operator class app.text_ops for type text using btree as operator 1 < (text, text), operator 2 <= (text, text), operator 3 = (text, text), operator 4 >= (text, text), operator 5 > (text, text), function 1 bttextcmp(text, text);",
      "create schema app;",
    ]);
    const unresolved = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    );
    const rangeStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create type app.varchar_range"),
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const operatorClassIndex = orderedSql.findIndex((sql) =>
      sql.includes("create operator class app.text_ops"),
    );
    const rangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.varchar_range"),
    );

    expect(unresolved).toHaveLength(0);
    expect(rangeStatement?.requires).toContainEqual({
      kind: "operator_class",
      schema: "app",
      name: "text_ops",
      signature: "(btree,varchar)",
    });
    expect(operatorClassIndex).toBeGreaterThanOrEqual(0);
    expect(rangeIndex).toBeGreaterThan(operatorClassIndex);
  });

  test("orders schema-qualified range subtypes before shadowing built-in names", async () => {
    const result = await analyzeAndSort([
      "create type app.range_over_int4 as range (subtype = app.int4);",
      "create type app.int4 as enum ('one', 'two');",
      "create schema app;",
    ]);
    const unresolved = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    );
    const rangeStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create type app.range_over_int4"),
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const subtypeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.int4 as enum"),
    );
    const rangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.range_over_int4"),
    );

    expect(unresolved).toHaveLength(0);
    expect(rangeStatement?.requires).toContainEqual({
      kind: "type",
      schema: "app",
      name: "int4",
    });
    expect(subtypeIndex).toBeGreaterThanOrEqual(0);
    expect(rangeIndex).toBeGreaterThan(subtypeIndex);
  });

  test("orders explicitly public range subtypes before shadowing built-in names", async () => {
    const result = await analyzeAndSort([
      "create type public.range_over_int4 as range (subtype = public.int4);",
      "create type public.int4 as enum ('one', 'two');",
    ]);
    const unresolved = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    );
    const rangeStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create type public.range_over_int4"),
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const subtypeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type public.int4 as enum"),
    );
    const rangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type public.range_over_int4"),
    );

    expect(unresolved).toHaveLength(0);
    expect(rangeStatement?.requires).toContainEqual({
      kind: "type",
      schema: "public",
      name: "int4",
    });
    expect(subtypeIndex).toBeGreaterThanOrEqual(0);
    expect(rangeIndex).toBeGreaterThan(subtypeIndex);
  });

  test("orders explicitly public array types before shadowing built-in names", async () => {
    const result = await analyzeAndSort([
      "create table public.events(id int primary key, values public.int4[] not null);",
      "create type public.int4 as enum ('one', 'two');",
    ]);
    const unresolved = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    );
    const tableStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create table public.events"),
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const typeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type public.int4 as enum"),
    );
    const tableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table public.events"),
    );

    expect(unresolved).toHaveLength(0);
    expect(tableStatement?.requires).toContainEqual({
      kind: "type",
      schema: "public",
      name: "int4[]",
    });
    expect(typeIndex).toBeGreaterThanOrEqual(0);
    expect(tableIndex).toBeGreaterThan(typeIndex);
  });

  test("orders explicit types before colliding implicit array names", async () => {
    const result = await analyzeAndSort([
      "create type app.foo as enum ('one', 'two');",
      "create table app.events(id int primary key, value app._foo not null);",
      "create type app._foo as enum ('one', 'two');",
      "create schema app;",
    ]);
    const validation = await validateAnalyzeResultWithPostgres(result);
    const duplicateCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "DUPLICATE_PRODUCER",
    ).length;
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const schemaIndex = orderedSql.findIndex((sql) =>
      sql.includes("create schema app"),
    );
    const explicitArrayTypeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app._foo"),
    );
    const baseTypeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.foo"),
    );
    const tableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table app.events"),
    );

    expect(duplicateCount).toBe(0);
    expect(executionErrors).toHaveLength(0);
    expect(schemaIndex).toBeGreaterThanOrEqual(0);
    expect(explicitArrayTypeIndex).toBeGreaterThan(schemaIndex);
    expect(baseTypeIndex).toBeGreaterThan(explicitArrayTypeIndex);
    expect(tableIndex).toBeGreaterThan(explicitArrayTypeIndex);
  }, 120000);

  test("does not diagnose colliding array typnames as self references", async () => {
    const result = await analyzeAndSort([
      "create table app.foo(id int primary key, value app._foo not null);",
      "create type app._foo as enum ('one', 'two');",
      "create schema app;",
    ]);
    const validation = await validateAnalyzeResultWithPostgres(result);
    const selfReferenceDiagnostics = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.message.includes("cannot reference its own row type"),
    );
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const enumIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app._foo"),
    );
    const tableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table app.foo"),
    );

    expect(selfReferenceDiagnostics).toHaveLength(0);
    expect(executionErrors).toHaveLength(0);
    expect(enumIndex).toBeGreaterThanOrEqual(0);
    expect(tableIndex).toBeGreaterThan(enumIndex);
  }, 120000);

  test("includes relation row types in implicit array collision context", async () => {
    const result = await analyzeAndSort([
      "create type app.foo as enum ('one', 'two');",
      "create table app._foo(id int primary key);",
      "create schema app;",
    ]);
    const validation = await validateAnalyzeResultWithPostgres(result);
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const tableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table app._foo"),
    );
    const enumIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.foo"),
    );

    expect(executionErrors).toHaveLength(0);
    expect(tableIndex).toBeGreaterThanOrEqual(0);
    expect(enumIndex).toBeGreaterThan(tableIndex);
  }, 120000);

  test("applies implicit array collision handling to row-type providers", async () => {
    const result = await analyzeAndSort([
      "create table app.uses_bar(id int primary key, value app._bar not null);",
      "create table app.bar(id int primary key);",
      "create type app._bar as enum ('one', 'two');",
      "create schema app;",
    ]);
    const validation = await validateAnalyzeResultWithPostgres(result);
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const duplicateCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "DUPLICATE_PRODUCER",
    ).length;
    const enumIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app._bar"),
    );
    const tableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table app.bar"),
    );
    const consumerIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table app.uses_bar"),
    );

    expect(duplicateCount).toBe(0);
    expect(executionErrors).toHaveLength(0);
    expect(enumIndex).toBeGreaterThanOrEqual(0);
    expect(tableIndex).toBeGreaterThan(enumIndex);
    expect(consumerIndex).toBeGreaterThan(enumIndex);
  }, 120000);

  test("includes external relation row types in implicit array collision context", async () => {
    const result = await analyzeAndSort(
      ["create table app.foo(id int primary key, value app._foo not null);"],
      {
        externalProviders: [{ kind: "table", schema: "app", name: "_foo" }],
      },
    );
    const missingExternalRowType = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "type" && ref.schema === "app" && ref.name === "_foo",
        ) === true,
    );
    const selfReferenceDiagnostics = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.message.includes("cannot reference its own row type"),
    );

    expect(missingExternalRowType).toHaveLength(0);
    expect(selfReferenceDiagnostics).toHaveLength(0);
  });

  test("includes external domains in implicit array collision context", async () => {
    const result = await analyzeAndSort(
      ["create type app.foo as enum ('one', 'two');", "create schema app;"],
      {
        externalProviders: [{ kind: "domain", schema: "app", name: "_foo" }],
      },
    );
    const enumStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create type app.foo as enum"),
    );
    const missingExternalDomain = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "type" && ref.schema === "app" && ref.name === "_foo",
        ) === true,
    );

    expect(enumStatement?.provides).not.toContainEqual({
      kind: "type",
      schema: "app",
      name: "_foo",
    });
    expect(enumStatement?.requires).toContainEqual({
      kind: "type",
      schema: "app",
      name: "_foo",
    });
    expect(missingExternalDomain).toHaveLength(0);
  });

  test("provides generated array typname aliases for custom types", async () => {
    const result = await analyzeAndSort([
      "create table app.people(id int primary key, moods app._mood not null);",
      "create type app.mood as enum ('sad', 'ok', 'happy');",
      "create schema app;",
    ]);
    const unresolvedArrayAlias = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "type" && ref.schema === "app" && ref.name === "_mood",
        ) === true,
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const typeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.mood as enum"),
    );
    const tableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table app.people"),
    );

    expect(unresolvedArrayAlias).toHaveLength(0);
    expect(typeIndex).toBeGreaterThanOrEqual(0);
    expect(tableIndex).toBeGreaterThan(typeIndex);
  });

  test("accepts explicit pg_catalog enum_ops for external enum range subtypes", async () => {
    const result = await analyzeAndSort(
      [
        "create schema app;",
        "create type app.mood_range as range (subtype = app.mood, subtype_opclass = pg_catalog.enum_ops);",
      ],
      {
        externalProviders: [
          { kind: "type", schema: "app", name: "mood", signature: "(enum)" },
        ],
      },
    );
    const enumOpsUnresolved = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "operator_class" &&
            ref.schema === "pg_catalog" &&
            ref.name === "enum_ops" &&
            ref.signature === "(btree,app.mood)",
        ) === true,
    );

    expect(enumOpsUnresolved).toHaveLength(0);
  });

  test("normalizes public enum subtype keys for omitted range opclasses", async () => {
    const result = await analyzeAndSort([
      "create type mood_range as range (subtype = mood);",
      "create type mood as enum ('sad', 'ok');",
    ]);
    const missingDefault = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.message.includes(
          "No default btree operator class provider found for range subtype 'mood'",
        ),
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const enumIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type mood as enum"),
    );
    const rangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type mood_range as range"),
    );

    expect(missingDefault).toHaveLength(0);
    expect(enumIndex).toBeGreaterThanOrEqual(0);
    expect(rangeIndex).toBeGreaterThan(enumIndex);
  });

  test("normalizes public range subtype keys for omitted range opclasses", async () => {
    const result = await analyzeAndSort([
      "create type period_wrapper as range (subtype = period);",
      "create type period as range (subtype = date);",
    ]);
    const missingDefault = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.message.includes(
          "No default btree operator class provider found for range subtype 'period'",
        ),
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const subtypeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type period as range"),
    );
    const wrapperIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type period_wrapper as range"),
    );

    expect(missingDefault).toHaveLength(0);
    expect(subtypeIndex).toBeGreaterThanOrEqual(0);
    expect(wrapperIndex).toBeGreaterThan(subtypeIndex);
  });

  test("diagnoses invalid pg_catalog range collations", async () => {
    const result = await analyzeAndSort([
      "create type app.bad_text_range as range (subtype = text, collation = pg_catalog.nope);",
      "create schema app;",
    ]);
    const invalidCollation = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "collation" &&
            ref.schema === "pg_catalog" &&
            ref.name === "nope",
        ) === true,
    );

    expect(invalidCollation).toHaveLength(1);
  });

  test("does not require producers for built-in arithmetic operator callbacks", async () => {
    const result = await analyzeAndSort([
      "create operator app.+ (function = int4pl, leftarg = int4, rightarg = int4);",
      "create operator app.+# (function = numeric_add, leftarg = numeric, rightarg = numeric);",
      "create schema app;",
    ]);
    const int4plUnresolved = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.name === "int4pl" &&
            ref.signature === "(int4,int4)",
        ) === true,
    );
    const numericAddUnresolved = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.name === "numeric_add" &&
            ref.signature === "(numeric,numeric)",
        ) === true,
    );
    const operatorStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create operator app.+"),
    );
    const numericOperatorStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create operator app.+#"),
    );

    expect(int4plUnresolved).toHaveLength(0);
    expect(numericAddUnresolved).toHaveLength(0);
    expect(operatorStatement?.requires).not.toContainEqual(
      expect.objectContaining({
        kind: "function",
        name: "int4pl",
      }),
    );
    expect(numericOperatorStatement?.requires).not.toContainEqual(
      expect.objectContaining({
        kind: "function",
        name: "numeric_add",
      }),
    );
  });

  test("does not require producers for built-in subtraction operator callbacks", async () => {
    const result = await analyzeAndSort([
      "create operator app.- (function = int4mi, leftarg = int4, rightarg = int4);",
      "create schema app;",
    ]);
    const int4miUnresolved = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.name === "int4mi" &&
            ref.signature === "(int4,int4)",
        ) === true,
    );
    const operatorStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create operator app.-"),
    );

    expect(int4miUnresolved).toHaveLength(0);
    expect(operatorStatement?.requires).not.toContainEqual(
      expect.objectContaining({
        kind: "function",
        name: "int4mi",
      }),
    );
  });

  test("requires operator implementation callbacks to be functions", async () => {
    const procedureResult = await analyzeAndSort([
      "create operator app.=== (function = app.eq, leftarg = int4, rightarg = int4);",
      "create procedure app.eq(a int4, b int4) language sql as $$ select 1 $$;",
      "create schema app;",
    ]);
    const aggregateResult = await analyzeAndSort([
      "create operator app.### (function = app.eq, leftarg = int4, rightarg = int4);",
      "create aggregate app.eq(int4, int4) (sfunc = int4pl, stype = int4);",
      "create schema app;",
    ]);
    const procedureImplementation = procedureResult.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.schema === "app" &&
            ref.name === "eq" &&
            ref.signature === "(pg_catalog.int4,pg_catalog.int4)",
        ) === true,
    );
    const aggregateImplementation = aggregateResult.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.schema === "app" &&
            ref.name === "eq" &&
            ref.signature === "(pg_catalog.int4,pg_catalog.int4)",
        ) === true,
    );

    expect(procedureImplementation).toHaveLength(1);
    expect(aggregateImplementation).toHaveLength(1);
  });

  test("tracks schemas used only by operator commutator and negator refs", async () => {
    const result = await analyzeAndSort([
      "create operator public.=== (function = int4eq, leftarg = int4, rightarg = int4, commutator = operator(app.===), negator = operator(app.<>));",
    ]);
    const operatorStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create operator public.==="),
    );
    const missingSchema = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) => ref.kind === "schema" && ref.name === "app",
        ) === true,
    );

    expect(operatorStatement?.requires).toContainEqual({
      kind: "schema",
      name: "app",
    });
    expect(missingSchema).toHaveLength(1);
  });

  test("diagnoses invalid pg_catalog order families", async () => {
    const result = await analyzeAndSort([
      "create operator class app.int4_brin_ops for type int4 using brin as operator 1 < (int4, int4) for order by pg_catalog.nope, function 1 brin_minmax_opcinfo(internal);",
      "create schema app;",
    ]);
    const invalidOrderFamily = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "operator_family" &&
            ref.schema === "pg_catalog" &&
            ref.name === "nope" &&
            ref.signature === "(btree)",
        ) === true,
    );

    expect(invalidOrderFamily).toHaveLength(1);
  });

  test("reports duplicate operator class names per schema and access method", async () => {
    const result = await analyzeAndSort([
      "create operator class app.shared_ops for type int4 using btree as operator 1 < (int4, int4), function 1 btint4cmp(int4, int4);",
      "create operator class app.shared_ops for type text using btree as operator 1 < (text, text), function 1 bttextcmp(text, text);",
      "create schema app;",
    ]);
    const duplicateOperatorClasses = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "DUPLICATE_PRODUCER" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "operator_class" &&
            ref.schema === "app" &&
            ref.name === "shared_ops" &&
            ref.signature === "(btree)",
        ) === true,
    );

    expect(duplicateOperatorClasses.length).toBeGreaterThan(0);
  });

  test("accepts built-in hash name_ops operator families", async () => {
    const result = await analyzeAndSort([
      "create operator class app.name_hash_ops for type name using hash family pg_catalog.name_ops as operator 1 = (name, name), function 1 hashname(name);",
      "create schema app;",
    ]);
    const unresolved = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    );

    expect(unresolved).toHaveLength(0);
  });

  test("accepts built-in brin minmax operator families", async () => {
    const result = await analyzeAndSort([
      "create operator class app.int4_brin_ops for type int4 using brin family pg_catalog.integer_minmax_ops as operator 1 < (int4, int4), operator 2 <= (int4, int4), operator 3 = (int4, int4), operator 4 >= (int4, int4), operator 5 > (int4, int4), function 1 brin_minmax_opcinfo(internal);",
      "create schema app;",
    ]);
    const unresolvedFamily = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "operator_family" &&
            ref.schema === "pg_catalog" &&
            ref.name === "integer_minmax_ops" &&
            ref.signature === "(brin)",
        ) === true,
    );
    const operatorClassStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator class app.int4_brin_ops"),
    );

    expect(unresolvedFamily).toHaveLength(0);
    expect(operatorClassStatement?.requires).not.toContainEqual({
      kind: "operator_family",
      schema: "pg_catalog",
      name: "integer_minmax_ops",
      signature: "(brin)",
    });
  });

  test("accepts built-in GiST and SP-GiST inet operator families", async () => {
    const result = await analyzeAndSort([
      "create operator class app.inet_gist_ops for type inet using gist family pg_catalog.inet_ops as operator 3 && (inet, inet), function 1 inet_consistent(internal, inet, int2, oid, internal);",
      "create operator class app.inet_spgist_ops for type inet using spgist family pg_catalog.inet_ops as operator 3 && (inet, inet), function 1 inet_spg_config(internal, internal);",
      "create schema app;",
    ]);
    const unresolvedInetFamilies = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "operator_family" &&
            ref.schema === "pg_catalog" &&
            ref.name === "inet_ops",
        ) === true,
    );

    expect(unresolvedInetFamilies).toHaveLength(0);
  });

  test("diagnoses non-existent GiST network_ops operator families", async () => {
    const result = await analyzeAndSort([
      "create operator class app.inet_gist_ops for type inet using gist family pg_catalog.network_ops as operator 3 && (inet, inet), function 1 inet_consistent(internal, inet, int2, oid, internal);",
      "create schema app;",
    ]);
    const invalidNetworkFamily = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "operator_family" &&
            ref.schema === "pg_catalog" &&
            ref.name === "network_ops" &&
            ref.signature === "(gist)",
        ) === true,
    );

    expect(invalidNetworkFamily).toHaveLength(1);
  });

  test("diagnoses btree-only pattern families used by hash opclasses", async () => {
    const result = await analyzeAndSort([
      "create operator class app.text_hash_ops for type text using hash family pg_catalog.text_pattern_ops as operator 1 = (text, text), function 1 hashtext(text);",
      "create schema app;",
    ]);
    const invalidHashFamily = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "operator_family" &&
            ref.schema === "pg_catalog" &&
            ref.name === "text_pattern_ops" &&
            ref.signature === "(hash)",
        ) === true,
    );
    const operatorClassStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator class app.text_hash_ops"),
    );

    expect(invalidHashFamily).toHaveLength(1);
    expect(operatorClassStatement?.requires).toContainEqual({
      kind: "operator_family",
      schema: "pg_catalog",
      name: "text_pattern_ops",
      signature: "(hash)",
    });
  });

  test("diagnoses invalid pg_catalog range support functions", async () => {
    const result = await analyzeAndSort([
      "create type app.r as range (subtype = int4, subtype_diff = pg_catalog.daterange_subdiff);",
      "create schema app;",
    ]);
    const invalidRangeSupportFunction = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.schema === "pg_catalog" &&
            ref.name === "daterange_subdiff" &&
            ref.signature === "(pg_catalog.int4,pg_catalog.int4)->float8",
        ) === true,
    );

    expect(invalidRangeSupportFunction).toHaveLength(1);
  });

  test("diagnoses invalid pg_catalog range subtype names", async () => {
    const result = await analyzeAndSort([
      "create type app.r as range (subtype = pg_catalog.nope);",
      "create schema app;",
    ]);
    const invalidRangeSubtype = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.message ===
          "No valid pg_catalog range subtype 'nope' found." &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "type" &&
            ref.schema === "pg_catalog" &&
            ref.name === "nope",
        ) === true,
    );

    expect(invalidRangeSubtype).toHaveLength(1);
  });

  test("diagnoses missing pg_catalog range subtype opclasses", async () => {
    const result = await analyzeAndSort([
      "create type app.r as range (subtype = int4, subtype_opclass = pg_catalog.nope);",
      "create schema app;",
    ]);
    const invalidRangeOperatorClass = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "operator_class" &&
            ref.schema === "pg_catalog" &&
            ref.name === "nope" &&
            ref.signature === "(btree,int4)",
        ) === true,
    );

    expect(invalidRangeOperatorClass).toHaveLength(1);
  });

  test("accepts record image support operators", async () => {
    const result = await analyzeAndSort([
      "create operator class app.record_image_ops for type record using btree as operator 1 *< (record, record), operator 2 *<= (record, record), operator 3 *= (record, record), operator 4 *>= (record, record), operator 5 *> (record, record), function 1 btrecordimagecmp(record, record);",
      "create schema app;",
    ]);
    const unresolved = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    );
    const operatorClassStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator class app.record_image_ops"),
    );

    expect(unresolved).toHaveLength(0);
    expect(operatorClassStatement?.requires).not.toContainEqual({
      kind: "operator",
      schema: "public",
      name: "*<",
      signature: "(record,record)",
    });
  });

  test("diagnoses qualified estimators with the wrong signature", async () => {
    const result = await analyzeAndSort([
      "create operator app.=== (function = texteq, leftarg = text, rightarg = text, restrict = pg_catalog.eqjoinsel);",
      "create schema app;",
    ]);
    const invalidQualifiedEstimator = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.schema === "pg_catalog" &&
            ref.name === "eqjoinsel" &&
            ref.signature === "(internal,oid,internal,int4)->float8",
        ) === true,
    );

    expect(invalidQualifiedEstimator).toHaveLength(1);
  });

  test("diagnoses unknown pg_catalog operator estimators", async () => {
    const result = await analyzeAndSort([
      "create operator app.=== (function = texteq, leftarg = text, rightarg = text, restrict = pg_catalog.nope);",
      "create schema app;",
    ]);
    const unknownEstimator = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.schema === "pg_catalog" &&
            ref.name === "nope" &&
            ref.signature === "(internal,oid,internal,int4)->float8",
        ) === true,
    );

    expect(unknownEstimator).toHaveLength(1);
  });

  test("accepts hash-only built-in equality operators", async () => {
    const result = await analyzeAndSort([
      "create operator class app.aclitem_hash_ops for type aclitem using hash as operator 1 = (aclitem, aclitem), function 1 hash_aclitem(aclitem);",
      "create schema app;",
    ]);
    const unresolved = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    );
    const operatorClassStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator class app.aclitem_hash_ops"),
    );

    expect(unresolved).toHaveLength(0);
    expect(operatorClassStatement?.requires).not.toContainEqual({
      kind: "operator",
      schema: "public",
      name: "=",
      signature: "(aclitem,aclitem)",
    });
  });

  test("accepts built-in xid and cid hash support operators", async () => {
    const result = await analyzeAndSort([
      "create operator class app.xid_hash_ops for type xid using hash as operator 1 = (xid, xid);",
      "create operator class app.cid_hash_ops for type cid using hash as operator 1 = (cid, cid);",
      "create schema app;",
    ]);
    const unresolved = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    );
    const xidOperatorClassStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator class app.xid_hash_ops"),
    );
    const cidOperatorClassStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator class app.cid_hash_ops"),
    );

    expect(unresolved).toHaveLength(0);
    expect(xidOperatorClassStatement?.requires).not.toContainEqual({
      kind: "operator",
      schema: "public",
      name: "=",
      signature: "(xid,xid)",
    });
    expect(cidOperatorClassStatement?.requires).not.toContainEqual({
      kind: "operator",
      schema: "public",
      name: "=",
      signature: "(cid,cid)",
    });
  });

  test("accepts built-in xid and cid hash support functions", async () => {
    const result = await analyzeAndSort([
      "create operator class app.xid_hash_ops for type xid using hash as operator 1 = (xid, xid), function 1 hashxid(xid), function 2 hashxidextended(xid, int8);",
      "create operator class app.cid_hash_ops for type cid using hash as operator 1 = (cid, cid), function 1 hashcid(cid), function 2 hashcidextended(cid, int8);",
      "create schema app;",
    ]);
    const unresolved = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    );
    const xidOperatorClassStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator class app.xid_hash_ops"),
    );
    const cidOperatorClassStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator class app.cid_hash_ops"),
    );

    expect(unresolved).toHaveLength(0);
    expect(xidOperatorClassStatement?.requires).not.toContainEqual({
      kind: "function",
      schema: "public",
      name: "hashxid",
      signature: "(xid)",
    });
    expect(xidOperatorClassStatement?.requires).not.toContainEqual({
      kind: "function",
      schema: "public",
      name: "hashxidextended",
      signature: "(xid,int8)",
    });
    expect(cidOperatorClassStatement?.requires).not.toContainEqual({
      kind: "function",
      schema: "public",
      name: "hashcid",
      signature: "(cid)",
    });
    expect(cidOperatorClassStatement?.requires).not.toContainEqual({
      kind: "function",
      schema: "public",
      name: "hashcidextended",
      signature: "(cid,int8)",
    });
  });

  test("diagnoses non-hash routines in hash support slot two", async () => {
    const result = await analyzeAndSort([
      "create operator class app.bad_hash_ops for type int4 using hash as function 2 btint48cmp(int4, int8);",
      "create schema app;",
    ]);
    const invalidHashSupportFunction = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.schema === "public" &&
            ref.name === "btint48cmp" &&
            ref.signature === "(int4,int8)->int8",
        ) === true,
    );

    expect(invalidHashSupportFunction).toHaveLength(1);
  });

  test("accepts built-in brin minmax support routines", async () => {
    const result = await analyzeAndSort([
      "create operator class app.int4_brin_ops for type int4 using brin as operator 1 < (int4, int4), operator 2 <= (int4, int4), operator 3 = (int4, int4), operator 4 >= (int4, int4), operator 5 > (int4, int4), function 1 brin_minmax_opcinfo(internal);",
      "create schema app;",
    ]);
    const unresolvedBrinMinmax = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.schema === "public" &&
            ref.name === "brin_minmax_opcinfo" &&
            ref.signature === "(internal)",
        ) === true,
    );

    expect(unresolvedBrinMinmax).toHaveLength(0);
  });

  test("accepts non-minmax built-in brin support routines", async () => {
    const result = await analyzeAndSort([
      "create operator class app.int4_brin_bloom_ops for type int4 using brin as operator 1 = (int4, int4), function 1 brin_bloom_opcinfo(internal);",
      "create operator class app.range_brin_multi_ops for type int4range using brin as operator 1 << (int4range, int4range), function 1 brin_minmax_multi_opcinfo(internal);",
      "create schema app;",
    ]);
    const unresolvedBrinSupportFunctions = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.schema === "public" &&
            ["brin_bloom_opcinfo", "brin_minmax_multi_opcinfo"].includes(
              ref.name,
            ) &&
            ref.signature === "(internal)",
        ) === true,
    );

    expect(unresolvedBrinSupportFunctions).toHaveLength(0);
  });

  test("does not require producers for built-in BRIN inclusion support operators", async () => {
    const result = await analyzeAndSort([
      "create operator class app.box_brin_inclusion_ops for type box using brin as operator 1 << (box, box), operator 3 && (box, box), operator 4 &> (box, box), operator 7 @> (box, box), operator 8 <@ (box, box), function 1 brin_inclusion_opcinfo(internal);",
      "create schema app;",
    ]);
    const unresolvedInclusionOperators = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "operator" &&
            ref.schema === "public" &&
            ["&&", "<<", "&>", "@>", "<@"].includes(ref.name),
        ) === true,
    );
    const inclusionOperatorRequirements = result.ordered.flatMap((statement) =>
      statement.requires.filter(
        (ref) =>
          ref.kind === "operator" &&
          ["&&", "<<", "&>", "@>", "<@"].includes(ref.name),
      ),
    );

    expect(unresolvedInclusionOperators).toHaveLength(0);
    expect(inclusionOperatorRequirements).toHaveLength(0);
  });

  test("does not require producers for unqualified BRIN minmax support routines", async () => {
    const result = await analyzeAndSort([
      "create operator class app.int4_brin_ops for type int4 using brin as function 1 brin_minmax_opcinfo(internal), function 2 brin_minmax_add_value(internal, internal, internal, internal), function 3 brin_minmax_consistent(internal, internal, internal), function 4 brin_minmax_union(internal, internal, internal);",
      "create schema app;",
    ]);
    const unresolvedBrinMinmax = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.schema === "public" &&
            [
              "brin_minmax_opcinfo",
              "brin_minmax_add_value",
              "brin_minmax_consistent",
              "brin_minmax_union",
            ].includes(ref.name),
        ) === true,
    );

    expect(unresolvedBrinMinmax).toHaveLength(0);
  });

  test("accepts built-in datetime cross-type support operators", async () => {
    const result = await analyzeAndSort([
      "create operator class app.date_timestamp_ops for type date using btree family pg_catalog.datetime_ops as operator 1 < (date, timestamp), function 1 date_cmp(date, date);",
      "create schema app;",
    ]);
    const unresolvedDatetimeOperator = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "operator" &&
            ref.schema === "public" &&
            ref.name === "<" &&
            ref.signature === "(date,pg_catalog.timestamp)",
        ) === true,
    );

    expect(unresolvedDatetimeOperator).toHaveLength(0);
  });

  test("matches typmod input functions with array argument providers", async () => {
    const result = await analyzeAndSort([
      "create type app.widget (input = app.widget_in, output = app.widget_out, typmod_in = app.widget_typmod_in, typmod_out = app.widget_typmod_out, internallength = 4, alignment = int4);",
      "create function app.widget_typmod_out(value int4) returns cstring language sql immutable strict as $$ select $1::text::cstring $$;",
      "create function app.widget_typmod_in(value cstring[]) returns int4 language sql immutable strict as $$ select 0 $$;",
      "create function app.widget_out(value app.widget) returns cstring language internal immutable strict as 'int4out';",
      "create function app.widget_in(value cstring) returns app.widget language internal immutable strict as 'int4in';",
      "create type app.widget;",
      "create schema app;",
    ]);
    const unresolved = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    );
    const baseTypeStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create type app.widget ("),
    );
    const typmodFunctionStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create function app.widget_typmod_in"),
    );

    expect(unresolved).toHaveLength(0);
    expect(baseTypeStatement?.requires).toContainEqual({
      kind: "function",
      schema: "app",
      name: "widget_typmod_in",
      signature: "(cstring[])->int4",
    });
    expect(typmodFunctionStatement?.provides).toContainEqual({
      kind: "function",
      schema: "app",
      name: "widget_typmod_in",
      signature: "(cstring[])->int4",
    });
  });

  test("preserves custom array type signatures for opclass support functions", async () => {
    const result = await analyzeAndSort([
      "create operator class app.score_array_ops for type app.score[] using btree as function 1 app.score_array_cmp(app.score[], app.score[]);",
      "create function app.score_array_cmp(a app.score[], b app.score[]) returns int4 language sql immutable strict as $$ select cardinality(a) - cardinality(b) $$;",
      "create type app.score as (value int4);",
      "create schema app;",
    ]);
    const unresolved = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    );
    const operatorClassStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator class app.score_array_ops"),
    );
    const functionStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create function app.score_array_cmp"),
    );

    expect(unresolved).toHaveLength(0);
    expect(operatorClassStatement?.requires).toContainEqual({
      kind: "function",
      schema: "app",
      name: "score_array_cmp",
      signature: "(app.score[],app.score[])->int4",
    });
    expect(functionStatement?.provides).toContainEqual({
      kind: "function",
      schema: "app",
      name: "score_array_cmp",
      signature: "(app.score[],app.score[])->int4",
    });
  });

  test("requires range and opclass callbacks to be functions", async () => {
    const rangeResult = await analyzeAndSort([
      "create type app.bad_range as range (subtype = int4, subtype_diff = app.diff);",
      "create procedure app.diff(a int4, b int4) language sql as $$ select 1 $$;",
      "create schema app;",
    ]);
    const opclassResult = await analyzeAndSort([
      "create operator class app.score_ops for type app.score using btree as function 1 app.score_cmp(app.score, app.score);",
      "create procedure app.score_cmp(a app.score, b app.score) language sql as $$ select 1 $$;",
      "create type app.score as (value int4);",
      "create schema app;",
    ]);
    const rangeCallback = rangeResult.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.schema === "app" &&
            ref.name === "diff" &&
            ref.signature === "(pg_catalog.int4,pg_catalog.int4)->float8",
        ) === true,
    );
    const opclassCallback = opclassResult.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.schema === "app" &&
            ref.name === "score_cmp" &&
            ref.signature === "(app.score,app.score)->int4",
        ) === true,
    );

    expect(rangeCallback).toHaveLength(1);
    expect(opclassCallback).toHaveLength(1);
  });

  test("matches exact callbacks with pg_catalog built-in type signatures", async () => {
    const result = await analyzeAndSort([
      "create type app.int_range as range (subtype = int4, subtype_diff = app.diff);",
      "create function app.diff(a pg_catalog.int4, b pg_catalog.int4) returns float8 language sql immutable as $$ select (a - b)::float8 $$;",
      "create schema app;",
    ]);
    const validation = await validateAnalyzeResultWithPostgres(result);
    const unresolvedDiff = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.schema === "app" &&
            ref.name === "diff" &&
            ref.signature === "(int4,int4)",
        ) === true,
    );
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );

    expect(unresolvedDiff).toHaveLength(0);
    expect(executionErrors).toHaveLength(0);
  }, 120000);

  test("preserves explicitly catalog-qualified range callback argument signatures", async () => {
    const result = await analyzeAndSort([
      "create type app.int_range as range (subtype = pg_catalog.int4, subtype_diff = app.diff);",
      "create function app.diff(a public.int4, b public.int4) returns float8 language sql immutable as $$ select 0::float8 $$;",
      "create type public.int4 as (value integer);",
      "create schema app;",
    ]);
    const unresolvedDiff = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.schema === "app" &&
            ref.name === "diff" &&
            ref.signature === "(pg_catalog.int4,pg_catalog.int4)->float8",
        ) === true,
    );
    const rangeStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create type app.int_range"),
    );

    expect(unresolvedDiff).toHaveLength(1);
    expect(rangeStatement?.requires).toContainEqual({
      kind: "function",
      schema: "app",
      name: "diff",
      signature: "(pg_catalog.int4,pg_catalog.int4)->float8",
    });
  });

  test("preserves implicitly catalog-qualified range callback argument signatures", async () => {
    const result = await analyzeAndSort([
      "create type app.int_range as range (subtype = int4, subtype_diff = app.diff);",
      "create function app.diff(a public.int4, b public.int4) returns float8 language sql immutable as $$ select 0::float8 $$;",
      "create type public.int4 as (value integer);",
      "create schema app;",
    ]);
    const unresolvedDiff = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.schema === "app" &&
            ref.name === "diff" &&
            ref.signature === "(pg_catalog.int4,pg_catalog.int4)->float8",
        ) === true,
    );
    const rangeStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create type app.int_range"),
    );

    expect(unresolvedDiff).toHaveLength(1);
    expect(rangeStatement?.requires).toContainEqual({
      kind: "function",
      schema: "app",
      name: "diff",
      signature: "(pg_catalog.int4,pg_catalog.int4)->float8",
    });
  });

  test("matches explicit external multirange providers in polymorphic opclasses", async () => {
    const result = await analyzeAndSort(
      [
        "create type app.wrap as range (subtype = app.period_multirange, subtype_opclass = pg_catalog.multirange_ops);",
        "create schema app;",
      ],
      {
        externalProviders: [
          {
            kind: "type",
            schema: "app",
            name: "period",
            signature: "(range)",
          },
          {
            kind: "type",
            schema: "app",
            name: "period_multirange",
            signature: "(multirange)",
          },
        ],
      },
    );
    const unresolved = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    );

    expect(unresolved).toHaveLength(0);
  });

  test("accepts built-in text concatenation operator callbacks", async () => {
    const result = await analyzeAndSort([
      "create operator app.|| (function = textcat, leftarg = text, rightarg = text);",
      "create schema app;",
    ]);
    const unresolvedTextcat = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.schema === "public" &&
            ref.name === "textcat" &&
            ref.signature === "(text,text)",
        ) === true,
    );

    expect(unresolvedTextcat).toHaveLength(0);
  });

  test("accepts catalog array typnames for polymorphic range opclasses", async () => {
    const result = await analyzeAndSort([
      "create type app.int_array_range as range (subtype = pg_catalog._int4, subtype_opclass = pg_catalog.array_ops);",
      "create schema app;",
    ]);
    const unresolved = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    );

    expect(unresolved).toHaveLength(0);
  });

  test("accepts generated array typnames for polymorphic range opclasses", async () => {
    const result = await analyzeAndSort([
      "create type app.mood_range as range (subtype = app._mood, subtype_opclass = pg_catalog.array_ops);",
      "create type app.mood as enum ('sad', 'ok', 'happy');",
      "create schema app;",
    ]);
    const unresolved = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const enumIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.mood as enum"),
    );
    const rangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.mood_range"),
    );

    expect(unresolved).toHaveLength(0);
    expect(enumIndex).toBeGreaterThanOrEqual(0);
    expect(rangeIndex).toBeGreaterThan(enumIndex);
  });

  test("diagnoses invalid pg_catalog operator argument types", async () => {
    const result = await analyzeAndSort(
      [
        "create operator app.=== (function = app.eq, leftarg = pg_catalog.no_such, rightarg = int4);",
        "create schema app;",
      ],
      {
        externalProviders: [
          {
            kind: "function",
            schema: "app",
            name: "eq",
            signature: "(pg_catalog.no_such,int4)",
          },
        ],
      },
    );
    const missingArgumentType = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "type" &&
            ref.schema === "pg_catalog" &&
            ref.name === "no_such",
        ) === true,
    );

    expect(missingArgumentType).toHaveLength(1);
  });

  test("accepts built-in GIN array support operators", async () => {
    const result = await analyzeAndSort([
      "create operator class app.array_gin_ops for type anyarray using gin as operator 1 && (anyarray, anyarray);",
      "create schema app;",
    ]);
    const unresolvedArrayOverlap = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "operator" &&
            ref.schema === "public" &&
            ref.name === "&&" &&
            ref.signature === "(anyarray,anyarray)",
        ) === true,
    );

    expect(unresolvedArrayOverlap).toHaveLength(0);
  });

  test("accepts built-in array restriction estimators", async () => {
    const result = await analyzeAndSort([
      "create operator app.@># (function = arraycontains, leftarg = anyarray, rightarg = anyarray, restrict = arraycontsel);",
      "create schema app;",
    ]);
    const unresolvedEstimator = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.schema === "public" &&
            ref.name === "arraycontsel",
        ) === true,
    );

    expect(unresolvedEstimator).toHaveLength(0);
  });

  test("accepts mixed built-in GIN jsonb support operators", async () => {
    const result = await analyzeAndSort([
      "create operator class app.jsonb_gin_ops for type jsonb using gin as operator 9 ? (jsonb, text), operator 10 ?| (jsonb, text[]), operator 11 ?& (jsonb, text[]);",
      "create schema app;",
    ]);
    const unresolvedGinJsonbOperators = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "operator" &&
            ref.schema === "public" &&
            ["?", "?|", "?&"].includes(ref.name),
        ) === true,
    );

    expect(unresolvedGinJsonbOperators).toHaveLength(0);
  });

  test("accepts cidr_ops for inet range subtypes", async () => {
    const result = await analyzeAndSort([
      "create type app.inet_range as range (subtype = inet, subtype_opclass = pg_catalog.cidr_ops);",
      "create schema app;",
    ]);
    const unresolved = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    );

    expect(unresolved).toHaveLength(0);
  });

  test("accepts remaining built-in GiST range support operators", async () => {
    const result = await analyzeAndSort([
      "create operator class app.int4range_gist_ops for type int4range using gist as operator 2 &< (int4range, int4range), operator 5 >> (int4range, int4range), operator 6 -|- (int4range, int4range), operator 18 = (int4range, int4range);",
      "create schema app;",
    ]);
    const unresolved = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    );

    expect(unresolved).toHaveLength(0);
  });

  test("accepts built-in GiST and SP-GiST distance support operators", async () => {
    const result = await analyzeAndSort([
      "create operator class app.point_gist_ops for type point using gist as operator 15 <-> (point, point) for order by float_ops;",
      "create operator class app.point_spgist_ops for type point using spgist as operator 15 <-> (point, point) for order by float_ops;",
      "create schema app;",
    ]);
    const unresolvedDistanceOperators = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "operator" &&
            ref.schema === "public" &&
            ref.name === "<->" &&
            ref.signature === "(point,point)",
        ) === true,
    );

    expect(unresolvedDistanceOperators).toHaveLength(0);
  });

  test("accepts jsonpath and text-search GIN support operators", async () => {
    const result = await analyzeAndSort([
      "create operator class app.jsonb_gin_ops for type jsonb using gin as operator 15 @? (jsonb, jsonpath), operator 16 @@ (jsonb, jsonpath);",
      "create operator class app.tsvector_gin_ops for type tsvector using gin as operator 2 @@@ (tsvector, tsquery);",
      "create schema app;",
    ]);
    const unresolved = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    );

    expect(unresolved).toHaveLength(0);
  });

  test("accepts remaining built-in SP-GiST support operators", async () => {
    const result = await analyzeAndSort([
      "create operator class app.inet_spgist_ops for type inet using spgist as operator 19 <> (inet, inet), operator 25 <<= (inet, inet), operator 26 >> (inet, inet), operator 27 >>= (inet, inet);",
      "create operator class app.text_spgist_ops for type text using spgist as operator 1 ~<~ (text, text), operator 11 < (text, text), operator 28 ^@ (text, text);",
      "create operator class app.range_spgist_ops for type int4range using spgist as operator 2 &< (int4range, int4range), operator 5 >> (int4range, int4range), operator 6 -|- (int4range, int4range), operator 18 = (int4range, int4range);",
      "create schema app;",
    ]);
    const unresolved = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    );

    expect(unresolved).toHaveLength(0);
  });

  test("accepts shipped GiST support routines", async () => {
    const result = await analyzeAndSort([
      "create operator class app.box_gist_ops for type box using gist family pg_catalog.box_ops as function 1 gist_box_consistent(internal, box, smallint, oid, internal);",
      "create schema app;",
    ]);
    const unresolvedGistFunction = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.schema === "public" &&
            ref.name === "gist_box_consistent" &&
            ref.signature === "(internal,box,pg_catalog.int2,oid,internal)",
        ) === true,
    );

    expect(unresolvedGistFunction).toHaveLength(0);
  });

  test("accepts shipped GIN support routines", async () => {
    const result = await analyzeAndSort([
      "create operator class app.array_gin_ops for type anyarray using gin family pg_catalog.array_ops as function 2 ginarrayextract(anyarray, internal, internal), function 3 ginqueryarrayextract(anyarray, internal, smallint, internal, internal, internal, internal), function 4 ginarrayconsistent(internal, smallint, anyarray, int4, internal, internal, internal, internal), function 6 ginarraytriconsistent(internal, smallint, anyarray, int4, internal, internal, internal);",
      "create schema app;",
    ]);
    const unresolvedGinFunctions = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.schema === "public" &&
            [
              "ginarrayextract",
              "ginqueryarrayextract",
              "ginarrayconsistent",
              "ginarraytriconsistent",
            ].includes(ref.name),
        ) === true,
    );

    expect(unresolvedGinFunctions).toHaveLength(0);
  });

  test("accepts shipped SP-GiST support routines", async () => {
    const result = await analyzeAndSort([
      "create operator class app.text_spgist_ops for type text using spgist family pg_catalog.text_ops as function 1 spg_text_config(internal, internal), function 2 spg_text_choose(internal, internal), function 3 spg_text_picksplit(internal, internal), function 4 spg_text_inner_consistent(internal, internal), function 5 spg_text_leaf_consistent(internal, internal);",
      "create schema app;",
    ]);
    const unresolvedSpgistFunctions = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.schema === "public" &&
            [
              "spg_text_config",
              "spg_text_choose",
              "spg_text_picksplit",
              "spg_text_inner_consistent",
              "spg_text_leaf_consistent",
            ].includes(ref.name),
        ) === true,
    );

    expect(unresolvedSpgistFunctions).toHaveLength(0);
  });

  test("accepts shipped JSONB GIN support routines", async () => {
    const result = await analyzeAndSort([
      "create operator class app.jsonb_ops for type jsonb using gin as function 1 gin_compare_jsonb(text, text), function 2 gin_extract_jsonb(jsonb, internal, internal), function 3 gin_extract_jsonb_query(jsonb, internal, int2, internal, internal, internal, internal), function 4 gin_consistent_jsonb(internal, int2, jsonb, int4, internal, internal, internal, internal), function 6 gin_triconsistent_jsonb(internal, int2, jsonb, int4, internal, internal, internal);",
      "create operator class app.jsonb_path_ops for type jsonb using gin as function 1 btint4cmp(int4, int4), function 2 gin_extract_jsonb_path(jsonb, internal, internal), function 3 gin_extract_jsonb_query_path(jsonb, internal, int2, internal, internal, internal, internal), function 4 gin_consistent_jsonb_path(internal, int2, jsonb, int4, internal, internal, internal, internal), function 6 gin_triconsistent_jsonb_path(internal, int2, jsonb, int4, internal, internal, internal);",
      "create schema app;",
    ]);
    const unresolvedJsonbGinFunctions = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.schema === "public" &&
            [
              "gin_compare_jsonb",
              "gin_consistent_jsonb",
              "gin_consistent_jsonb_path",
              "gin_extract_jsonb",
              "gin_extract_jsonb_path",
              "gin_extract_jsonb_query",
              "gin_extract_jsonb_query_path",
              "gin_triconsistent_jsonb",
              "gin_triconsistent_jsonb_path",
            ].includes(ref.name),
        ) === true,
    );

    expect(unresolvedJsonbGinFunctions).toHaveLength(0);
  });

  test("diagnoses invalid pg_catalog operator class data types", async () => {
    const result = await analyzeAndSort([
      "create operator class app.bad_ops for type pg_catalog.no_such using gist as operator 1 << (box, box);",
      "create schema app;",
    ]);
    const missingDataType = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "type" &&
            ref.schema === "pg_catalog" &&
            ref.name === "no_such",
        ) === true,
    );

    expect(missingDataType).toHaveLength(1);
  });

  test("accepts shipped pg_catalog operator argument types", async () => {
    const result = await analyzeAndSort(
      [
        "create operator app.@@@ (function = app.jsonpath_match, leftarg = pg_catalog.jsonpath, rightarg = pg_catalog.jsonpath);",
        "create schema app;",
      ],
      {
        externalProviders: [
          {
            kind: "function",
            schema: "app",
            name: "jsonpath_match",
            signature: "(pg_catalog.jsonpath,pg_catalog.jsonpath)",
          },
        ],
      },
    );
    const missingJsonpath = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "type" &&
            ref.schema === "pg_catalog" &&
            ref.name === "jsonpath",
        ) === true,
    );

    expect(missingJsonpath).toHaveLength(0);
  });

  test("accepts polymorphic pseudo-types as built-in operator argument types", async () => {
    const result = await analyzeAndSort(
      [
        "create operator app.=== (function = app.compat_eq, leftarg = anycompatiblearray, rightarg = anycompatiblearray);",
        "create schema app;",
      ],
      {
        externalProviders: [
          {
            kind: "function",
            schema: "app",
            name: "compat_eq",
            signature: "(anycompatiblearray,anycompatiblearray)",
          },
        ],
      },
    );
    const missingPseudoTypes = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "type" &&
            ref.schema === "public" &&
            ref.name === "anycompatiblearray",
        ) === true,
    );

    expect(missingPseudoTypes).toHaveLength(0);
  });

  test("accepts valid pg_catalog types outside the local built-in allow-list", async () => {
    const result = await analyzeAndSort(
      [
        "create operator app.=== (function = app.int2vector_eq, leftarg = pg_catalog.int2vector, rightarg = pg_catalog.int2vector);",
        "create schema app;",
      ],
      {
        externalProviders: [
          {
            kind: "function",
            schema: "app",
            name: "int2vector_eq",
            signature: "(pg_catalog.int2vector,pg_catalog.int2vector)",
          },
        ],
      },
    );
    const missingInt2vector = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "type" &&
            ref.schema === "pg_catalog" &&
            ref.name === "int2vector",
        ) === true,
    );

    expect(missingInt2vector).toHaveLength(0);
  });

  test("accepts built-in btree name_ops operator families", async () => {
    const result = await analyzeAndSort([
      "create operator class app.name_btree_ops for type name using btree family pg_catalog.name_ops as operator 1 < (name, name), operator 2 <= (name, name), operator 3 = (name, name), operator 4 >= (name, name), operator 5 > (name, name), function 1 btnamecmp(name, name);",
      "create schema app;",
    ]);
    const unresolvedFamily = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "operator_family" &&
            ref.schema === "pg_catalog" &&
            ref.name === "name_ops" &&
            ref.signature === "(btree)",
        ) === true,
    );

    expect(unresolvedFamily).toHaveLength(0);
  });

  test("accepts built-in cross-width integer operator callbacks", async () => {
    const result = await analyzeAndSort([
      "create operator app.< (function = int48lt, leftarg = int4, rightarg = int8);",
      "create schema app;",
    ]);
    const unresolvedIntegerCallback = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.schema === "public" &&
            ref.name === "int48lt" &&
            ref.signature === "(int4,int8)",
        ) === true,
    );

    expect(unresolvedIntegerCallback).toHaveLength(0);
  });

  test("accepts built-in JSONB operator callbacks", async () => {
    const result = await analyzeAndSort([
      "create operator app.@> (function = jsonb_contains, leftarg = jsonb, rightarg = jsonb);",
      "create operator app.?| (function = jsonb_exists_any, leftarg = jsonb, rightarg = text[]);",
      "create schema app;",
    ]);
    const unresolvedJsonbCallbacks = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.schema === "public" &&
            ["jsonb_contains", "jsonb_exists_any"].includes(ref.name),
        ) === true,
    );

    expect(unresolvedJsonbCallbacks).toHaveLength(0);
  });

  test("infers return-aware operators from built-in callbacks", async () => {
    const result = await analyzeAndSort([
      "create operator class app.int4_ops for type int4 using btree as operator 1 app.< (int4, int4), function 1 btint4cmp(int4, int4);",
      "create operator app.< (function = int4lt, leftarg = int4, rightarg = int4);",
      "create schema app;",
    ]);
    const missingBooleanOperator = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "operator" &&
            ref.schema === "app" &&
            ref.name === "<" &&
            ref.signature === "(int4,int4)->bool",
        ) === true,
    );
    const operatorStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create operator app.<"),
    );

    expect(missingBooleanOperator).toHaveLength(0);
    expect(operatorStatement?.provides).toContainEqual({
      kind: "operator",
      schema: "app",
      name: "<",
      signature: "(int4,int4)->bool",
    });
  });

  test("infers return-aware operators from external callbacks", async () => {
    const result = await analyzeAndSort(
      [
        "create operator class app.score_ops for type app.score using btree as operator 1 app.< (app.score, app.score), function 1 app.score_cmp(app.score, app.score);",
        "create operator app.< (function = app.score_lt_external, leftarg = app.score, rightarg = app.score);",
        "create function app.score_cmp(a app.score, b app.score) returns int4 language sql immutable strict as $$ select 0 $$;",
        "create type app.score as (value int4);",
        "create schema app;",
      ],
      {
        externalProviders: [
          {
            kind: "function",
            schema: "app",
            name: "score_lt_external",
            signature: "(app.score,app.score)->bool",
          },
        ],
      },
    );
    const missingBooleanOperator = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "operator" &&
            ref.schema === "app" &&
            ref.name === "<" &&
            ref.signature === "(app.score,app.score)->bool",
        ) === true,
    );
    const operatorStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create operator app.<"),
    );

    expect(missingBooleanOperator).toHaveLength(0);
    expect(operatorStatement?.provides).toContainEqual({
      kind: "operator",
      schema: "app",
      name: "<",
      signature: "(app.score,app.score)->bool",
    });
  });

  test("does not require built-in schemas for operator link refs", async () => {
    const result = await analyzeAndSort([
      "create operator app.=== (function = int4eq, leftarg = int4, rightarg = int4, commutator = operator(pg_catalog.=), negator = operator(information_schema.<>));",
      "create schema app;",
    ]);
    const operatorStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create operator app.==="),
    );
    const builtInSchemaDiagnostics = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "schema" &&
            (ref.name === "pg_catalog" || ref.name === "information_schema"),
        ) === true,
    );

    expect(operatorStatement?.requires).not.toContainEqual({
      kind: "schema",
      name: "pg_catalog",
    });
    expect(operatorStatement?.requires).not.toContainEqual({
      kind: "schema",
      name: "information_schema",
    });
    expect(builtInSchemaDiagnostics).toHaveLength(0);
  });

  test("requires explicit support operator argument type refs", async () => {
    const result = await analyzeAndSort(
      [
        "create operator class app.score_ops for type app.score using btree as operator 1 app.< (app.other, app.other), function 1 app.score_cmp(app.score, app.score);",
        "create function app.score_cmp(a app.score, b app.score) returns int4 language sql immutable strict as $$ select case when (a).value < (b).value then -1 when (a).value > (b).value then 1 else 0 end $$;",
        "create type app.other as (value int4);",
        "create type app.score as (value int4);",
        "create schema app;",
      ],
      {
        externalProviders: [
          {
            kind: "operator",
            schema: "app",
            name: "<",
            signature: "(app.other,app.other)",
          },
        ],
      },
    );
    const operatorClassStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator class app.score_ops"),
    );

    expect(operatorClassStatement?.requires).toContainEqual({
      kind: "type",
      schema: "app",
      name: "other",
    });
  });

  test("matches operator family comment signatures to create providers", async () => {
    const result = await analyzeAndSort([
      "comment on operator family app.ops using btree is 'range helpers';",
      "create operator family app.ops using btree;",
      "create schema app;",
    ]);
    const unresolved = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    );
    const familyStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create operator family app.ops"),
    );
    const commentStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("comment on operator family app.ops"),
    );

    expect(unresolved).toHaveLength(0);
    expect(familyStatement?.provides).toContainEqual({
      kind: "operator_family",
      schema: "app",
      name: "ops",
      signature: "(btree)",
    });
    expect(commentStatement?.requires).toContainEqual({
      kind: "operator_family",
      schema: "app",
      name: "ops",
      signature: "(btree)",
    });
  });

  test("diagnoses unknown pg_catalog range support callbacks", async () => {
    const result = await analyzeAndSort([
      "create type app.r as range (subtype = int4, subtype_diff = pg_catalog.no_such);",
      "create schema app;",
    ]);
    const missingRangeCallback = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.schema === "pg_catalog" &&
            ref.name === "no_such" &&
            ref.signature === "(pg_catalog.int4,pg_catalog.int4)->float8",
        ) === true,
    );

    expect(missingRangeCallback).toHaveLength(1);
  });

  test("diagnoses unknown pg_catalog operator implementation callbacks", async () => {
    const result = await analyzeAndSort([
      "create operator app.<< (function = pg_catalog.no_such, leftarg = int4, rightarg = int4);",
      "create schema app;",
    ]);
    const missingOperatorCallback = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.schema === "pg_catalog" &&
            ref.name === "no_such" &&
            ref.signature === "(pg_catalog.int4,pg_catalog.int4)",
        ) === true,
    );

    expect(missingOperatorCallback).toHaveLength(1);
  });

  test("diagnoses unknown pg_catalog opclass support items", async () => {
    const result = await analyzeAndSort([
      "create operator class app.bad_ops for type int4 using gist as operator 1 pg_catalog.@#@ (int4, int4), function 1 pg_catalog.no_such(internal), storage pg_catalog.no_such;",
      "create schema app;",
    ]);
    const missingSupportOperator = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "operator" &&
            ref.schema === "pg_catalog" &&
            ref.name === "@#@" &&
            ref.signature === "(int4,int4)",
        ) === true,
    );
    const missingSupportRoutine = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.schema === "pg_catalog" &&
            ref.name === "no_such" &&
            ref.signature === "(internal)->bool",
        ) === true,
    );
    const missingStorageType = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "type" &&
            ref.schema === "pg_catalog" &&
            ref.name === "no_such",
        ) === true,
    );

    expect(missingSupportOperator).toHaveLength(1);
    expect(missingSupportRoutine).toHaveLength(1);
    expect(missingStorageType).toHaveLength(1);
  });

  test("diagnoses unknown pg_catalog opclass support operator argument types", async () => {
    const result = await analyzeAndSort(
      [
        "create operator class app.bad_ops for type int4 using btree as operator 1 app.< (pg_catalog.no_such, pg_catalog.no_such), function 1 btint4cmp(int4, int4);",
        "create schema app;",
      ],
      {
        externalProviders: [
          {
            kind: "operator",
            schema: "app",
            name: "<",
            signature: "(pg_catalog.no_such,pg_catalog.no_such)",
          },
        ],
      },
    );
    const missingOperatorArgTypes = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "type" &&
            ref.schema === "pg_catalog" &&
            ref.name === "no_such",
        ) === true,
    );

    expect(missingOperatorArgTypes.length).toBeGreaterThan(0);
  });

  test("diagnoses unknown pg_catalog opclass support function class argument types", async () => {
    const result = await analyzeAndSort(
      [
        "create operator class app.bad_ops for type int4 using btree as function 1 (pg_catalog.no_such, pg_catalog.no_such) app.cmp(int4, int4);",
        "create schema app;",
      ],
      {
        externalProviders: [
          {
            kind: "function",
            schema: "app",
            name: "cmp",
            signature: "(int4,int4)",
          },
        ],
      },
    );
    const missingFunctionClassArgTypes = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "type" &&
            ref.schema === "pg_catalog" &&
            ref.name === "no_such",
        ) === true,
    );

    expect(missingFunctionClassArgTypes.length).toBeGreaterThan(0);
  });

  test("diagnoses self row-type and range subtype references", async () => {
    const tableResult = await analyzeAndSort([
      "create table app.events(parent app.events);",
      "create schema app;",
    ]);
    const rangeResult = await analyzeAndSort([
      "create type app.r as range (subtype = app.r);",
      "create schema app;",
    ]);
    const selfRowType = tableResult.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "type" &&
            ref.schema === "app" &&
            ref.name === "events",
        ) === true,
    );
    const selfRangeSubtype = rangeResult.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "type" && ref.schema === "app" && ref.name === "r",
        ) === true,
    );

    expect(selfRowType).toHaveLength(1);
    expect(selfRangeSubtype).toHaveLength(1);
  });

  test("diagnoses explicit multirange names that reuse the range type name", async () => {
    const result = await analyzeAndSort([
      "create type app.r as range (subtype = int4, multirange_type_name = app.r);",
      "create schema app;",
    ]);
    const duplicateMultirangeName = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "type" && ref.schema === "app" && ref.name === "r",
        ) === true,
    );

    expect(duplicateMultirangeName.length).toBeGreaterThan(0);
  });

  test("orders default multirange arrays after colliding type owners", async () => {
    const result = await analyzeAndSort([
      "create type app.price_range as range (subtype = int4);",
      "create table app.uses_price(spans app.price_multirange);",
      "create type app._price_multirange as enum ('low', 'high');",
      "create schema app;",
    ]);
    const unresolved = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const enumIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app._price_multirange"),
    );
    const rangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.price_range"),
    );
    const tableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table app.uses_price"),
    );

    expect(unresolved).toHaveLength(0);
    expect(enumIndex).toBeGreaterThanOrEqual(0);
    expect(rangeIndex).toBeGreaterThan(enumIndex);
    expect(tableIndex).toBeGreaterThan(rangeIndex);
  });

  test("orders explicit multiranges before colliding generated array typnames", async () => {
    const result = await analyzeAndSort([
      "create type app.foo as enum ('low', 'high');",
      "create table app.uses_foo(value app.foo);",
      "create type app.foo_range as range (subtype = int4, multirange_type_name = app._foo);",
      "create schema app;",
    ]);
    const unresolved = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    );
    const duplicateCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "DUPLICATE_PRODUCER",
    ).length;
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const rangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.foo_range"),
    );
    const enumIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.foo as enum"),
    );
    const tableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table app.uses_foo"),
    );

    expect(unresolved).toHaveLength(0);
    expect(duplicateCount).toBe(0);
    expect(rangeIndex).toBeGreaterThanOrEqual(0);
    expect(enumIndex).toBeGreaterThan(rangeIndex);
    expect(tableIndex).toBeGreaterThan(enumIndex);
  });

  test("orders default multiranges before colliding generated array typnames", async () => {
    const result = await analyzeAndSort([
      "create type app.foo_multirange as enum ('low', 'high');",
      "create table app.uses_foo(value app._foo_multirange);",
      "create type app._foo_range as range (subtype = int4);",
      "create schema app;",
    ]);
    const unresolved = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    );
    const duplicateCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "DUPLICATE_PRODUCER",
    ).length;
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const rangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app._foo_range"),
    );
    const enumIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.foo_multirange"),
    );
    const tableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table app.uses_foo"),
    );

    expect(unresolved).toHaveLength(0);
    expect(duplicateCount).toBe(0);
    expect(rangeIndex).toBeGreaterThanOrEqual(0);
    expect(enumIndex).toBeGreaterThan(rangeIndex);
    expect(tableIndex).toBeGreaterThan(rangeIndex);
  });

  test("external type providers satisfy generated array typname aliases", async () => {
    const result = await analyzeAndSort(
      ["create table app.events(score app._score);", "create schema app;"],
      {
        externalProviders: [{ kind: "type", schema: "app", name: "score" }],
      },
    );
    const unresolvedGeneratedArray = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "type" &&
            ref.schema === "app" &&
            ref.name === "_score",
        ) === true,
    );

    expect(unresolvedGeneratedArray).toHaveLength(0);
  });

  test("orders operator families after custom access methods", async () => {
    const result = await analyzeAndSort(
      [
        "create operator family app.score_family using myam;",
        "create access method myam type index handler app.myam_handler;",
        "create schema app;",
      ],
      {
        externalProviders: [
          { kind: "function", schema: "app", name: "myam_handler" },
        ],
      },
    );
    const unknownCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNKNOWN_STATEMENT_CLASS",
    ).length;
    const unresolvedAccessMethod = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) => ref.kind === "access_method" && ref.name === "myam",
        ) === true,
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const accessMethodIndex = orderedSql.findIndex((sql) =>
      sql.includes("create access method myam"),
    );
    const familyIndex = orderedSql.findIndex((sql) =>
      sql.includes("create operator family app.score_family"),
    );

    expect(unknownCount).toBe(0);
    expect(unresolvedAccessMethod).toHaveLength(0);
    expect(accessMethodIndex).toBeGreaterThanOrEqual(0);
    expect(familyIndex).toBeGreaterThan(accessMethodIndex);
  });

  test("tracks custom access methods required by indexes", async () => {
    const result = await analyzeAndSort([
      "create index events_score_idx on app.events using myam (score);",
      "create table app.events(score int4);",
      "create schema app;",
    ]);
    const missingAccessMethod = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "access_method" &&
            ref.name === "myam" &&
            ref.signature === "(index)",
        ) === true,
    );
    const indexStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create index events_score_idx"),
    );

    expect(missingAccessMethod).toHaveLength(1);
    expect(indexStatement?.requires).toContainEqual({
      kind: "access_method",
      name: "myam",
      signature: "(index)",
    });
  });

  test("catalog-qualifies built-in operator callback argument signatures", async () => {
    const result = await analyzeAndSort([
      "create operator app.< (function = app.lt, leftarg = int4, rightarg = int4);",
      "create function app.lt(a public.int4, b public.int4) returns boolean language sql immutable strict as $$ select false $$;",
      "create type public.int4 as (value integer);",
      "create schema app;",
    ]);
    const missingCatalogCallback = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.schema === "app" &&
            ref.name === "lt" &&
            ref.signature === "(pg_catalog.int4,pg_catalog.int4)",
        ) === true,
    );
    const operatorStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create operator app.<"),
    );

    expect(missingCatalogCallback).toHaveLength(1);
    expect(operatorStatement?.requires).toContainEqual({
      kind: "function",
      schema: "app",
      name: "lt",
      signature: "(pg_catalog.int4,pg_catalog.int4)",
    });
  });

  test("does not require producers for built-in array operator callbacks", async () => {
    const result = await analyzeAndSort([
      "create operator app.&& (function = arrayoverlap, leftarg = anyarray, rightarg = anyarray);",
      "create operator app.@> (function = arraycontains, leftarg = anyarray, rightarg = anyarray);",
      "create operator app.<@ (function = arraycontained, leftarg = anyarray, rightarg = anyarray);",
      "create operator app.=== (function = array_eq, leftarg = anyarray, rightarg = anyarray);",
      "create schema app;",
    ]);
    const unresolvedArrayCallbacks = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.schema === "public" &&
            [
              "array_eq",
              "arraycontained",
              "arraycontains",
              "arrayoverlap",
            ].includes(ref.name),
        ) === true,
    );

    expect(unresolvedArrayCallbacks).toHaveLength(0);
  });

  test("tracks explicit opclass support function argument types", async () => {
    const missingLocalTypeResult = await analyzeAndSort(
      [
        "create operator class app.score_ops for type app.score using btree as function 1 app.score_cmp(app.other, app.other);",
        "create type app.score as (value int4);",
        "create schema app;",
      ],
      {
        externalProviders: [
          {
            kind: "function",
            schema: "app",
            name: "score_cmp",
            signature: "(app.other,app.other)",
          },
        ],
      },
    );
    const invalidCatalogTypeResult = await analyzeAndSort(
      [
        "create operator class app.score_ops for type app.score using btree as function 1 app.score_cmp(pg_catalog.no_such, pg_catalog.no_such);",
        "create type app.score as (value int4);",
        "create schema app;",
      ],
      {
        externalProviders: [
          {
            kind: "function",
            schema: "app",
            name: "score_cmp",
            signature: "(pg_catalog.no_such,pg_catalog.no_such)",
          },
        ],
      },
    );
    const missingLocalType = missingLocalTypeResult.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "type" && ref.schema === "app" && ref.name === "other",
        ) === true,
    );
    const missingCatalogType = invalidCatalogTypeResult.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "type" &&
            ref.schema === "pg_catalog" &&
            ref.name === "no_such",
        ) === true,
    );

    expect(missingLocalType).toHaveLength(1);
    expect(missingCatalogType.length).toBeGreaterThan(0);
  });

  test("treats access method handler pseudo-types as built-ins", async () => {
    const result = await analyzeAndSort([
      "create access method myam type index handler app.myam_handler;",
      "create function app.myam_handler(internal) returns index_am_handler language internal strict as 'btreehandler';",
      "create schema app;",
    ]);
    const missingHandlerTypes = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "type" &&
            ["index_am_handler", "table_am_handler"].includes(ref.name),
        ) === true,
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const functionIndex = orderedSql.findIndex((sql) =>
      sql.includes("create function app.myam_handler"),
    );
    const accessMethodIndex = orderedSql.findIndex((sql) =>
      sql.includes("create access method myam"),
    );

    expect(missingHandlerTypes).toHaveLength(0);
    expect(functionIndex).toBeGreaterThanOrEqual(0);
    expect(accessMethodIndex).toBeGreaterThan(functionIndex);
  });

  test("maps access method comments to access method dependencies", async () => {
    const result = await analyzeAndSort([
      "comment on access method myam is 'custom index access method';",
    ]);
    const missingAccessMethod = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) => ref.kind === "access_method" && ref.name === "myam",
        ) === true,
    );
    const commentStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("comment on access method myam"),
    );

    expect(commentStatement?.requires).toContainEqual({
      kind: "access_method",
      name: "myam",
    });
    expect(missingAccessMethod).toHaveLength(1);
  });

  test("does not match opclass support operators against public shadow types", async () => {
    const result = await analyzeAndSort(
      [
        "create operator class app.int4_ops for type int4 using btree as operator 1 app.<;",
        "create type public.int4 as (value integer);",
        "create schema app;",
      ],
      {
        externalProviders: [
          {
            kind: "operator",
            schema: "app",
            name: "<",
            signature: "(public.int4,public.int4)",
          },
        ],
      },
    );
    const missingCatalogOperator = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "operator" && ref.schema === "app" && ref.name === "<",
        ) === true,
    );

    expect(missingCatalogOperator).toHaveLength(1);
  });

  test("does not match inferred opclass support functions against public shadow types", async () => {
    const result = await analyzeAndSort(
      [
        "create operator class app.int4_ops for type int4 using btree as function 1 app.cmp;",
        "create type public.int4 as (value integer);",
        "create schema app;",
      ],
      {
        externalProviders: [
          {
            kind: "function",
            schema: "app",
            name: "cmp",
            signature: "(public.int4,public.int4)",
          },
        ],
      },
    );
    const missingCatalogFunction = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.schema === "app" &&
            ref.name === "cmp",
        ) === true,
    );

    expect(missingCatalogFunction).toHaveLength(1);
  });

  test("requires access method handlers with the internal handler signature", async () => {
    const result = await analyzeAndSort(
      [
        "create access method myam type index handler app.myam_handler;",
        "create schema app;",
      ],
      {
        externalProviders: [
          {
            kind: "function",
            schema: "app",
            name: "myam_handler",
            signature: "(text)",
          },
        ],
      },
    );
    const missingHandler = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.schema === "app" &&
            ref.name === "myam_handler" &&
            ref.signature === "(internal)->index_am_handler",
        ) === true,
    );

    expect(missingHandler).toHaveLength(1);
  });

  test("does not require producers for unqualified built-in access method handlers", async () => {
    const result = await analyzeAndSort([
      "create access method copied_btree type index handler bthandler;",
      "create access method copied_heap type table handler heap_tableam_handler;",
    ]);
    const missingBuiltInHandlers = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.schema === "public" &&
            ["bthandler", "heap_tableam_handler"].includes(ref.name),
        ) === true,
    );

    expect(missingBuiltInHandlers).toHaveLength(0);
  });

  test("requires index access methods for operator families and classes", async () => {
    const tableAccessMethodResult = await analyzeAndSort(
      [
        "create operator family app.table_family using myam;",
        "create access method myam type table handler app.myam_handler;",
        "create schema app;",
      ],
      {
        externalProviders: [
          {
            kind: "function",
            schema: "app",
            name: "myam_handler",
            signature: "(internal)->table_am_handler",
          },
        ],
      },
    );
    const heapAccessMethodResult = await analyzeAndSort([
      "create operator family app.heap_family using heap;",
      "create schema app;",
    ]);
    const missingTableIndexMethod = tableAccessMethodResult.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "access_method" &&
            ref.name === "myam" &&
            ref.signature === "(index)",
        ) === true,
    );
    const missingHeapIndexMethod = heapAccessMethodResult.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "access_method" &&
            ref.name === "heap" &&
            ref.signature === "(index)",
        ) === true,
    );

    expect(missingTableIndexMethod).toHaveLength(1);
    expect(missingHeapIndexMethod).toHaveLength(1);
  });

  test("reports duplicate access method names across access method types", async () => {
    const result = await analyzeAndSort(
      [
        "create access method myam type index handler app.index_handler;",
        "create access method myam type table handler app.table_handler;",
        "create schema app;",
      ],
      {
        externalProviders: [
          {
            kind: "function",
            schema: "app",
            name: "index_handler",
            signature: "(internal)->index_am_handler",
          },
          {
            kind: "function",
            schema: "app",
            name: "table_handler",
            signature: "(internal)->table_am_handler",
          },
        ],
      },
    );
    const duplicateAccessMethod = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "DUPLICATE_PRODUCER" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "access_method" &&
            ref.name === "myam" &&
            ref.signature === undefined,
        ) === true,
    );

    expect(duplicateAccessMethod.length).toBeGreaterThan(0);
  });

  test("does not let catalog-typed operators satisfy public shadow opclasses", async () => {
    const result = await analyzeAndSort([
      "create operator class app.public_int4_ops for type public.int4 using btree as operator 1 app.<;",
      "create operator app.< (function = app.lt, leftarg = int4, rightarg = int4);",
      "create function app.lt(a int4, b int4) returns boolean language sql immutable strict as $$ select false $$;",
      "create type public.int4 as (value integer);",
      "create schema app;",
    ]);
    const missingPublicOperator = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "operator" &&
            ref.schema === "app" &&
            ref.name === "<" &&
            ref.signature === "(public.int4,public.int4)",
        ) === true,
    );

    expect(missingPublicOperator).toHaveLength(1);
  });

  test("does not satisfy operator comments with same-name different-arg operators", async () => {
    const result = await analyzeAndSort([
      "comment on operator app.< (int4, int4) is 'less-than';",
      "create operator app.< (function = app.text_lt, leftarg = text, rightarg = text);",
      "create function app.text_lt(a text, b text) returns boolean language sql immutable strict as $$ select a < b $$;",
      "create schema app;",
    ]);
    const missingOperatorCommentTarget = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "operator" &&
            ref.schema === "app" &&
            ref.name === "<" &&
            ref.signature === "(int4,int4)",
        ) === true,
    );

    expect(missingOperatorCommentTarget).toHaveLength(1);
  });

  test("does not report unresolved built-in access method comments", async () => {
    const result = await analyzeAndSort([
      "comment on access method btree is 'built-in btree access method';",
      "comment on access method heap is 'built-in heap access method';",
    ]);
    const missingBuiltInAccessMethods = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "access_method" &&
            ["btree", "heap"].includes(ref.name),
        ) === true,
    );

    expect(missingBuiltInAccessMethods).toHaveLength(0);
  });

  test("does not match base type callbacks against public shadow catalog args", async () => {
    const result = await analyzeAndSort(
      [
        "create type app.score (input = app.score_in, output = app.score_out);",
        "create type public.int4 as (value integer);",
        "create schema app;",
      ],
      {
        externalProviders: [
          {
            kind: "function",
            schema: "app",
            name: "score_in",
            signature: "(cstring,oid,public.int4)",
          },
          {
            kind: "function",
            schema: "app",
            name: "score_out",
            signature: "(app.score)->cstring",
          },
        ],
      },
    );
    const missingCatalogCallback = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.schema === "app" &&
            ref.name === "score_in",
        ) === true,
    );

    expect(missingCatalogCallback).toHaveLength(1);
  });

  test("does not match NONE support operators against binary providers", async () => {
    const result = await analyzeAndSort(
      [
        "create schema app;",
        "create type app.score as (value int4);",
        "create operator class app.score_ops for type app.score using btree as operator 1 app.! (NONE, app.score), function 1 app.score_cmp(app.score, app.score);",
      ],
      {
        externalProviders: [
          {
            kind: "operator",
            schema: "app",
            name: "!",
            signature: "(app.score,app.score)",
          },
          {
            kind: "function",
            schema: "app",
            name: "score_cmp",
            signature: "(app.score,app.score)->int4",
          },
        ],
      },
    );
    const missingUnaryOperator = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "operator" &&
            ref.schema === "app" &&
            ref.name === "!" &&
            ref.signature === "(none,app.score)",
        ) === true,
    );
    const bogusNoneType = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) => ref.kind === "type" && ref.name === "none",
        ) === true,
    );

    expect(missingUnaryOperator).toHaveLength(1);
    expect(bogusNoneType).toHaveLength(0);
  });

  test("honors annotated default operator class providers for omitted range subtype opclasses", async () => {
    const result = await analyzeAndSort([
      "create schema app;",
      "create type app.score as (value int4);",
      "-- pg-topo:provides operator_class:app.score_ops(btree,app.score)\ncreate extension score_ops;",
      "create type app.score_range as range (subtype = app.score);",
    ]);
    const missingDefaultOperatorClass = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.message.includes("No default btree operator class provider"),
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const extensionIndex = orderedSql.findIndex((sql) =>
      sql.includes("create extension score_ops"),
    );
    const rangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.score_range"),
    );

    expect(missingDefaultOperatorClass).toHaveLength(0);
    expect(extensionIndex).toBeGreaterThanOrEqual(0);
    expect(rangeIndex).toBeGreaterThan(extensionIndex);
  });

  test("does not match operator estimators against public shadow catalog args", async () => {
    const result = await analyzeAndSort(
      [
        "create operator app.< (function = app.lt, leftarg = int4, rightarg = int4, restrict = app.score_sel);",
        "create type public.int4 as (value integer);",
        "create schema app;",
      ],
      {
        externalProviders: [
          {
            kind: "function",
            schema: "app",
            name: "lt",
            signature: "(int4,int4)",
          },
          {
            kind: "function",
            schema: "app",
            name: "score_sel",
            signature: "(internal,oid,internal,public.int4)",
          },
        ],
      },
    );
    const missingCatalogEstimator = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.schema === "app" &&
            ref.name === "score_sel",
        ) === true,
    );

    expect(missingCatalogEstimator).toHaveLength(1);
  });

  test("diagnoses base types that copy themselves through type options", async () => {
    const likeResult = await analyzeAndSort([
      "create type app.foo (input = app.foo_in, output = app.foo_out, like = app.foo);",
      "create schema app;",
    ]);
    const elementResult = await analyzeAndSort([
      "create type app.foo (input = app.foo_in, output = app.foo_out, element = app.foo[]);",
      "create schema app;",
    ]);
    const selfLike = likeResult.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "type" && ref.schema === "app" && ref.name === "foo",
        ) === true,
    );
    const selfElement = elementResult.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "type" && ref.schema === "app" && ref.name === "foo[]",
        ) === true,
    );

    expect(selfLike).toHaveLength(1);
    expect(selfElement).toHaveLength(1);
  });

  test("requires subtype_diff callbacks to return float8", async () => {
    const result = await analyzeAndSort([
      "create type app.int_range as range (subtype = int4, subtype_diff = app.diff);",
      "create function app.diff(a int4, b int4) returns int4 language sql immutable as $$ select a - b $$;",
      "create schema app;",
    ]);
    const missingDiff = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.schema === "app" &&
            ref.name === "diff" &&
            ref.signature === "(pg_catalog.int4,pg_catalog.int4)->float8",
        ) === true,
    );

    expect(missingDiff).toHaveLength(1);
  });

  test("requires operator estimator callbacks to return float8", async () => {
    const result = await analyzeAndSort([
      "create operator app.<# (function = app.score_lt, leftarg = int4, rightarg = int4, restrict = app.score_sel);",
      "create function app.score_sel(internal, oid, internal, int4) returns int4 language internal stable strict as 'eqsel';",
      "create function app.score_lt(a int4, b int4) returns boolean language sql immutable strict as $$ select a < b $$;",
      "create schema app;",
    ]);
    const missingEstimator = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.schema === "app" &&
            ref.name === "score_sel" &&
            ref.signature === "(internal,oid,internal,int4)->float8",
        ) === true,
    );

    expect(missingEstimator).toHaveLength(1);
  });

  test("requires access method handlers to return the selected handler type", async () => {
    const indexResult = await analyzeAndSort([
      "create access method myindexam type index handler app.myam_handler;",
      "create function app.myam_handler(internal) returns void language internal strict as 'bthandler';",
      "create schema app;",
    ]);
    const tableResult = await analyzeAndSort([
      "create access method mytableam type table handler app.myam_handler;",
      "create function app.myam_handler(internal) returns void language internal strict as 'heap_tableam_handler';",
      "create schema app;",
    ]);
    const missingIndexHandler = indexResult.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.schema === "app" &&
            ref.name === "myam_handler" &&
            ref.signature === "(internal)->index_am_handler",
        ) === true,
    );
    const missingTableHandler = tableResult.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.schema === "app" &&
            ref.name === "myam_handler" &&
            ref.signature === "(internal)->table_am_handler",
        ) === true,
    );

    expect(missingIndexHandler).toHaveLength(1);
    expect(missingTableHandler).toHaveLength(1);
  });

  test("requires btree support function 1 callbacks to return int4", async () => {
    const result = await analyzeAndSort([
      "create operator class app.score_ops for type app.score using btree as function 1 app.score_cmp(app.score, app.score);",
      "create function app.score_cmp(a app.score, b app.score) returns bool language sql immutable strict as $$ select (a).value = (b).value $$;",
      "create type app.score as (value int4);",
      "create schema app;",
    ]);
    const missingComparator = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.schema === "app" &&
            ref.name === "score_cmp" &&
            ref.signature === "(app.score,app.score)->int4",
        ) === true,
    );

    expect(missingComparator).toHaveLength(1);
  });

  test("requires btree options support callbacks to return void", async () => {
    const result = await analyzeAndSort([
      "create operator class app.score_ops for type app.score using btree as function 5 app.score_options(internal);",
      "create function app.score_options(value internal) returns int4 language internal stable strict as 'bttoptions';",
      "create type app.score as (value int4);",
      "create schema app;",
    ]);
    const missingOptions = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.schema === "app" &&
            ref.name === "score_options" &&
            ref.signature === "(internal)->void",
        ) === true,
    );

    expect(missingOptions).toHaveLength(1);
  });

  test("requires all options support callbacks to return void", async () => {
    const result = await analyzeAndSort([
      "create operator class app.score_hash_ops for type app.score using hash as function 3 app.hash_options(internal);",
      "create operator class app.score_gist_ops for type app.score using gist as function 10 app.gist_options(internal);",
      "create operator class app.score_spgist_ops for type app.score using spgist as function 6 app.spgist_options(internal);",
      "create operator class app.score_gin_ops for type app.score using gin as function 7 app.gin_options(internal);",
      "create operator class app.score_brin_ops for type app.score using brin as function 5 app.brin_options(internal);",
      "create function app.hash_options(value internal) returns int4 language internal stable strict as 'hashoptions';",
      "create function app.gist_options(value internal) returns int4 language internal stable strict as 'gistoptions';",
      "create function app.spgist_options(value internal) returns int4 language internal stable strict as 'spgoptions';",
      "create function app.gin_options(value internal) returns int4 language internal stable strict as 'ginoptions';",
      "create function app.brin_options(value internal) returns int4 language internal stable strict as 'brinoptions';",
      "create type app.score as (value int4);",
      "create schema app;",
    ]);
    const missingOptions = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.schema === "app" &&
            [
              "hash_options",
              "gist_options",
              "spgist_options",
              "gin_options",
              "brin_options",
            ].includes(ref.name) &&
            ref.signature === "(internal)->void",
        ) === true,
    );

    expect(missingOptions).toHaveLength(5);
  });

  test("requires BRIN support callbacks to return PostgreSQL callback types", async () => {
    const result = await analyzeAndSort([
      "create operator class app.score_brin_ops for type int4 using brin as function 1 app.brin_opcinfo(internal), function 2 app.brin_add_value(internal, internal, internal, internal), function 3 app.brin_consistent(internal, internal, internal), function 4 app.brin_union(internal, internal, internal);",
      "create function app.brin_opcinfo(value internal) returns int4 language sql immutable strict as $$ select 0 $$;",
      "create function app.brin_add_value(a internal, b internal, c internal, d internal) returns int4 language sql immutable strict as $$ select 0 $$;",
      "create function app.brin_consistent(a internal, b internal, c internal) returns int4 language sql immutable strict as $$ select 0 $$;",
      "create function app.brin_union(a internal, b internal, c internal) returns int4 language sql immutable strict as $$ select 0 $$;",
      "create schema app;",
    ]);
    const missingBrinCallbacks = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.schema === "app" &&
            [
              "brin_opcinfo",
              "brin_add_value",
              "brin_consistent",
              "brin_union",
            ].includes(ref.name),
        ) === true,
    );

    expect(missingBrinCallbacks).toHaveLength(4);
    expect(
      missingBrinCallbacks.flatMap(
        (diagnostic) =>
          diagnostic.objectRefs?.map((ref) => ref.signature) ?? [],
      ),
    ).toEqual(
      expect.arrayContaining([
        "(internal)->internal",
        "(internal,internal,internal,internal)->bool",
        "(internal,internal,internal)->bool",
        "(internal,internal,internal)->void",
      ]),
    );
  });

  test("requires GiST, GIN, and SP-GiST support callbacks to return PostgreSQL callback types", async () => {
    const result = await analyzeAndSort([
      "create operator class app.box_gist_ops for type box using gist as function 1 app.gist_consistent(internal, box, int2, oid, internal);",
      "create operator class app.int_gin_ops for type int4 using gin as function 4 app.gin_consistent(internal, int2, int4, int4, internal, internal, internal, internal);",
      "create operator class app.int_spgist_ops for type int4 using spgist as function 5 app.spgist_leaf_consistent(internal, internal);",
      "create function app.gist_consistent(a internal, b box, c int2, d oid, e internal) returns int4 language sql immutable strict as $$ select 0 $$;",
      "create function app.gin_consistent(a internal, b int2, c int4, d int4, e internal, f internal, g internal, h internal) returns int4 language sql immutable strict as $$ select 0 $$;",
      "create function app.spgist_leaf_consistent(a internal, b internal) returns int4 language sql immutable strict as $$ select 0 $$;",
      "create schema app;",
    ]);
    const missingCallbacks = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.schema === "app" &&
            [
              "gist_consistent",
              "gin_consistent",
              "spgist_leaf_consistent",
            ].includes(ref.name),
        ) === true,
    );

    expect(missingCallbacks).toHaveLength(3);
    expect(
      missingCallbacks.flatMap(
        (diagnostic) =>
          diagnostic.objectRefs?.map((ref) => ref.signature) ?? [],
      ),
    ).toEqual(
      expect.arrayContaining([
        "(internal,box,int2,oid,internal)->bool",
        "(internal,int2,int4,int4,internal,internal,internal,internal)->bool",
        "(internal,internal)->bool",
      ]),
    );
  });

  test("requires base type callbacks to return PostgreSQL callback types", async () => {
    const result = await analyzeAndSort([
      "create type app.score (input = app.score_in, output = app.score_out, send = app.score_send, internallength = 4, alignment = int4);",
      "create function app.score_in(value cstring) returns int4 language internal immutable strict as 'int4in';",
      "create function app.score_out(value app.score) returns text language internal immutable strict as 'int4out';",
      "create function app.score_send(value app.score) returns text language internal immutable strict as 'int4send';",
      "create type app.score;",
      "create schema app;",
    ]);
    const missingInput = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.schema === "app" &&
            ref.name === "score_in" &&
            ref.signature === "(cstring)->app.score",
        ) === true,
    );
    const missingOutput = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.schema === "app" &&
            ref.name === "score_out" &&
            ref.signature === "(app.score)->cstring",
        ) === true,
    );
    const missingSend = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.schema === "app" &&
            ref.name === "score_send" &&
            ref.signature === "(app.score)->bytea",
        ) === true,
    );

    expect(missingInput).toHaveLength(1);
    expect(missingOutput).toHaveLength(1);
    expect(missingSend).toHaveLength(1);
  });

  test("does not treat non-default local opclasses as omitted range subtype defaults", async () => {
    const result = await analyzeAndSort([
      "create type app.score_range as range (subtype = app.score);",
      "create operator class app.score_ops for type app.score using btree as function 1 app.score_cmp(app.score, app.score);",
      "create function app.score_cmp(a app.score, b app.score) returns int4 language sql immutable strict as $$ select 0 $$;",
      "create type app.score as (value int4);",
      "create schema app;",
    ]);
    const missingDefault = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.message.includes(
          "No default btree operator class provider found for range subtype 'app.score'",
        ),
    );

    expect(missingDefault).toHaveLength(1);
  });

  test("does not allow set-returning functions to satisfy scalar range callbacks", async () => {
    const result = await analyzeAndSort([
      "create type app.int_range as range (subtype = int4, subtype_diff = app.diff);",
      "create function app.diff(a int4, b int4) returns setof float8 language sql immutable as $$ select (a - b)::float8 $$;",
      "create schema app;",
    ]);
    const missingScalarDiff = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.schema === "app" &&
            ref.name === "diff" &&
            ref.signature === "(pg_catalog.int4,pg_catalog.int4)->float8",
        ) === true,
    );

    expect(missingScalarDiff).toHaveLength(1);
  });

  test("does not allow RETURNS TABLE functions to satisfy scalar range callbacks", async () => {
    const result = await analyzeAndSort([
      "create type app.int_range as range (subtype = int4, subtype_diff = app.diff);",
      "create function app.diff(a int4, b int4) returns table(result float8) language sql immutable as $$ select (a - b)::float8 $$;",
      "create schema app;",
    ]);
    const missingScalarDiff = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.schema === "app" &&
            ref.name === "diff" &&
            ref.signature === "(pg_catalog.int4,pg_catalog.int4)->float8",
        ) === true,
    );

    expect(missingScalarDiff).toHaveLength(1);
  });

  test("does not report implicit built-in type refs as self references", async () => {
    const result = await analyzeAndSort([
      "create table public.int4 (value int4);",
      "create domain public.float8 as float8;",
    ]);
    const builtInSelfReferences = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "type" &&
            ref.schema === "public" &&
            (ref.name === "int4" || ref.name === "float8"),
        ) === true,
    );

    expect(builtInSelfReferences).toHaveLength(0);
  });

  test("keeps wrong-return local built-in shadows as range callback requirements", async () => {
    const result = await analyzeAndSort([
      "create type app.int_range as range (subtype = int4, subtype_diff = int4range_subdiff);",
      "create function public.int4range_subdiff(a int4, b int4) returns int4 language sql immutable as $$ select a - b $$;",
      "create schema app;",
    ]);
    const missingScalarDiff = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.schema === "public" &&
            ref.name === "int4range_subdiff" &&
            ref.signature === "(pg_catalog.int4,pg_catalog.int4)->float8",
        ) === true,
    );

    expect(missingScalarDiff).toHaveLength(1);
  });

  test("keeps wrong-return external built-in shadows as range callback requirements", async () => {
    const result = await analyzeAndSort(
      [
        "create type app.int_range as range (subtype = int4, subtype_diff = int4range_subdiff);",
        "create schema app;",
      ],
      {
        externalProviders: [
          {
            kind: "function",
            schema: "public",
            name: "int4range_subdiff",
            signature: "(pg_catalog.int4,pg_catalog.int4)->int4",
          },
        ],
      },
    );
    const missingScalarDiff = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.schema === "public" &&
            ref.name === "int4range_subdiff" &&
            ref.signature === "(pg_catalog.int4,pg_catalog.int4)->float8",
        ) === true,
    );

    expect(missingScalarDiff).toHaveLength(1);
  });

  test("preserves explicit public built-in type refs when deduping implicit refs", async () => {
    const result = await analyzeAndSort([
      "create table app.t(a public.int4, b int4);",
      "create schema app;",
    ]);
    const missingExplicitPublicInt = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "type" &&
            ref.schema === "public" &&
            ref.name === "int4",
        ) === true,
    );

    expect(missingExplicitPublicInt).toHaveLength(1);
  });

  test("requires opclass search operators to return boolean", async () => {
    const result = await analyzeAndSort([
      "create operator class app.score_ops for type app.score using btree as operator 1 app.< (app.score, app.score);",
      "create operator app.< (function = app.score_cmp, leftarg = app.score, rightarg = app.score);",
      "create function app.score_cmp(a app.score, b app.score) returns int4 language sql immutable strict as $$ select 0 $$;",
      "create type app.score as (value int4);",
      "create schema app;",
    ]);
    const missingBooleanOperator = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "operator" &&
            ref.schema === "app" &&
            ref.name === "<" &&
            ref.signature === "(app.score,app.score)->bool",
        ) === true,
    );

    expect(missingBooleanOperator).toHaveLength(1);
  });

  test("requires opclass order-by operators to return the order family type", async () => {
    const result = await analyzeAndSort([
      "create operator class app.score_ops for type app.score using gist as operator 1 app.<-> (app.score, app.score) for order by float_ops;",
      "create operator app.<-> (function = app.score_distance, leftarg = app.score, rightarg = app.score);",
      "create function app.score_distance(a app.score, b app.score) returns int4 language sql immutable strict as $$ select 0 $$;",
      "create type app.score as (value int4);",
      "create schema app;",
    ]);
    const missingFloatOperator = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "operator" &&
            ref.schema === "app" &&
            ref.name === "<->" &&
            ref.signature === "(app.score,app.score)->float8",
        ) === true,
    );

    expect(missingFloatOperator).toHaveLength(1);
  });
});
