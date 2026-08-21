import { describe, expect, test } from "bun:test";
import { buildGraph } from "../src/graph/build-graph";
import {
  createObjectRefFromAst,
  SHELL_TYPE_SIGNATURE,
} from "../src/model/object-ref";
import type { StatementClass } from "../src/classify/classify-statement";
import type { ObjectRef, StatementNode } from "../src/model/types";

const node = (
  statementIndex: number,
  sql: string,
  provides: ObjectRef[],
  requires: ObjectRef[],
  statementClass: StatementClass = "UNKNOWN",
): StatementNode => ({
  id: { filePath: "<test>", statementIndex },
  sql,
  statementClass,
  provides,
  requires,
  phase: "pre_data",
  annotations: {
    dependsOn: [],
    requires: [],
    provides: [],
  },
});

describe("buildGraph", () => {
  test("matches public shell type providers for unqualified type requirements", () => {
    const shellType = node(
      0,
      "create type int_range;",
      [
        createObjectRefFromAst(
          "type",
          "int_range",
          "public",
          SHELL_TYPE_SIGNATURE,
        ),
      ],
      [],
      "CREATE_TYPE",
    );
    const finalRangeType = node(
      1,
      "create type int_range as range (subtype = int4, canonical = int_range_canonical);",
      [createObjectRefFromAst("type", "int_range", "public")],
      [createObjectRefFromAst("function", "int_range_canonical", "public")],
      "CREATE_TYPE",
    );
    const canonicalFunction = node(
      2,
      "create function int_range_canonical(value int_range) returns int_range language internal immutable as 'int4range_canonical';",
      [createObjectRefFromAst("function", "int_range_canonical", "public")],
      [createObjectRefFromAst("type", "int_range")],
      "CREATE_FUNCTION",
    );

    const graph = buildGraph([shellType, finalRangeType, canonicalFunction]);
    const shellToFunction = graph.edges.get(0)?.has(2) ?? false;
    const rangeToFunction = graph.edges.get(1)?.has(2) ?? false;

    expect(shellToFunction).toBe(true);
    expect(rangeToFunction).toBe(false);
  });

  test("does not use shell type providers for ordinary consumers", () => {
    const shellType = node(
      0,
      "create type app.foo;",
      [createObjectRefFromAst("type", "foo", "app", SHELL_TYPE_SIGNATURE)],
      [],
      "CREATE_TYPE",
    );
    const finalType = node(
      1,
      "create type app.foo as range (subtype = int4);",
      [createObjectRefFromAst("type", "foo", "app")],
      [createObjectRefFromAst("table", "uses_foo", "app")],
      "CREATE_TYPE",
    );
    const ordinaryConsumer = node(
      2,
      "create table app.uses_foo(value app.foo);",
      [createObjectRefFromAst("table", "uses_foo", "app")],
      [createObjectRefFromAst("type", "foo", "app")],
      "CREATE_TABLE",
    );

    const graph = buildGraph([shellType, finalType, ordinaryConsumer]);
    const shellToTable = graph.edges.get(0)?.has(2) ?? false;
    const finalTypeToTable = graph.edges.get(1)?.has(2) ?? false;

    expect(shellToTable).toBe(false);
    expect(finalTypeToTable).toBe(true);
  });
});
