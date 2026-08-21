import { describe, expect, test } from "bun:test";
import {
  classifyStatement,
  phaseForStatementClass,
  statementClassAstNode,
} from "../src/classify/classify-statement";

describe("classifyStatement", () => {
  test("returns UNKNOWN for unknown AST node type", () => {
    expect(classifyStatement({ SomeUnknownNode: {} })).toBe("UNKNOWN");
  });

  test("returns CREATE_PROCEDURE when CreateFunctionStmt has is_procedure true", () => {
    expect(
      classifyStatement({
        CreateFunctionStmt: { is_procedure: true },
      }),
    ).toBe("CREATE_PROCEDURE");
  });

  test("returns CREATE_FUNCTION when CreateFunctionStmt has is_procedure false", () => {
    expect(
      classifyStatement({
        CreateFunctionStmt: { is_procedure: false },
      }),
    ).toBe("CREATE_FUNCTION");
  });

  test("returns CREATE_MATERIALIZED_VIEW when ViewStmt view has relpersistence m", () => {
    expect(
      classifyStatement({
        ViewStmt: {
          view: { relpersistence: "m" },
        },
      }),
    ).toBe("CREATE_MATERIALIZED_VIEW");
  });

  test("returns CREATE_VIEW when ViewStmt view has non-m relpersistence", () => {
    expect(
      classifyStatement({
        ViewStmt: {
          view: { relpersistence: "p" },
        },
      }),
    ).toBe("CREATE_VIEW");
  });

  test("returns CREATE_MATERIALIZED_VIEW when CreateTableAsStmt has objtype OBJECT_MATVIEW", () => {
    expect(
      classifyStatement({
        CreateTableAsStmt: { objtype: "OBJECT_MATVIEW" },
      }),
    ).toBe("CREATE_MATERIALIZED_VIEW");
  });

  test("returns CREATE_TABLE when CreateTableAsStmt has other objtype", () => {
    expect(
      classifyStatement({
        CreateTableAsStmt: { objtype: "OBJECT_TABLE" },
      }),
    ).toBe("CREATE_TABLE");
  });

  test("returns CREATE_TYPE for CreateRangeStmt", () => {
    expect(
      classifyStatement({
        CreateRangeStmt: {
          typeName: [{ String: { sval: "app" } }, { String: { sval: "ids" } }],
        },
      }),
    ).toBe("CREATE_TYPE");
  });

  test("returns CREATE_TYPE for shell type DefineStmt", () => {
    expect(
      classifyStatement({
        DefineStmt: {
          kind: "OBJECT_TYPE",
          defnames: [
            { String: { sval: "app" } },
            { String: { sval: "int_range" } },
          ],
        },
      }),
    ).toBe("CREATE_TYPE");
  });

  test("returns CREATE_OPERATOR_CLASS for CreateOpClassStmt", () => {
    expect(
      classifyStatement({
        CreateOpClassStmt: {
          opclassname: [
            { String: { sval: "app" } },
            { String: { sval: "int4_range_ops" } },
          ],
        },
      }),
    ).toBe("CREATE_OPERATOR_CLASS");
  });

  test("returns CREATE_OPERATOR_FAMILY for CreateOpFamilyStmt", () => {
    expect(
      classifyStatement({
        CreateOpFamilyStmt: {
          opfamilyname: [
            { String: { sval: "app" } },
            { String: { sval: "score_family" } },
          ],
        },
      }),
    ).toBe("CREATE_OPERATOR_FAMILY");
  });

  test("returns CREATE_OPERATOR for operator DefineStmt", () => {
    expect(
      classifyStatement({
        DefineStmt: {
          kind: "OBJECT_OPERATOR",
          defnames: [{ String: { sval: "app" } }, { String: { sval: "<#" } }],
        },
      }),
    ).toBe("CREATE_OPERATOR");
  });

  test("returns REVOKE when GrantStmt has is_grant false", () => {
    expect(
      classifyStatement({
        GrantStmt: { is_grant: false },
      }),
    ).toBe("REVOKE");
  });

  test("returns GRANT when GrantStmt has is_grant true", () => {
    expect(
      classifyStatement({
        GrantStmt: { is_grant: true },
      }),
    ).toBe("GRANT");
  });

  test("returns GRANT when GrantStmt omits is_grant", () => {
    expect(classifyStatement({ GrantStmt: {} })).toBe("GRANT");
  });

  test("returns ALTER_PUBLICATION for AlterPublicationStmt", () => {
    expect(classifyStatement({ AlterPublicationStmt: {} })).toBe(
      "ALTER_PUBLICATION",
    );
  });

  test("returns ALTER_SUBSCRIPTION for AlterSubscriptionStmt", () => {
    expect(classifyStatement({ AlterSubscriptionStmt: {} })).toBe(
      "ALTER_SUBSCRIPTION",
    );
  });

  test("returns UNKNOWN for null or non-object", () => {
    expect(classifyStatement(null)).toBe("UNKNOWN");
    expect(classifyStatement(undefined)).toBe("UNKNOWN");
    expect(classifyStatement(42)).toBe("UNKNOWN");
    expect(classifyStatement("create table t();")).toBe("UNKNOWN");
  });

  test("returns UNKNOWN for empty object", () => {
    expect(classifyStatement({})).toBe("UNKNOWN");
  });
});

describe("phaseForStatementClass", () => {
  test("returns data_structures for UNKNOWN", () => {
    expect(phaseForStatementClass("UNKNOWN")).toBe("data_structures");
  });

  test("returns correct phase for known classes", () => {
    expect(phaseForStatementClass("CREATE_SCHEMA")).toBe("bootstrap");
    expect(phaseForStatementClass("CREATE_TABLE")).toBe("data_structures");
    expect(phaseForStatementClass("CREATE_PROCEDURE")).toBe("routines");
    expect(phaseForStatementClass("GRANT")).toBe("privileges");
  });
});

describe("statementClassAstNode", () => {
  test("returns undefined for null or non-object", () => {
    expect(statementClassAstNode(null)).toBeUndefined();
    expect(statementClassAstNode(undefined)).toBeUndefined();
    expect(statementClassAstNode(42)).toBeUndefined();
    expect(statementClassAstNode("x")).toBeUndefined();
  });

  test("returns undefined for empty object", () => {
    expect(statementClassAstNode({})).toBeUndefined();
  });

  test("returns first key for object with one key", () => {
    expect(statementClassAstNode({ CreateStmt: {} })).toBe("CreateStmt");
    expect(statementClassAstNode({ ViewStmt: { view: {} } })).toBe("ViewStmt");
  });
});
