import { describe, expect, test } from "bun:test";
import type { StableId } from "../core/stable-id.ts";
import type { Action } from "./plan.ts";
import { findDestructionMetadataViolations } from "./safety.ts";

const relation = (
  kind: "table" | "materializedView",
  name = "old",
): StableId => ({ kind, schema: "app", name });

const column = (name = "old_column"): StableId => ({
  kind: "column",
  schema: "app",
  table: "t",
  name,
});

const typeAttribute = (name = "old_attribute"): StableId => ({
  kind: "typeAttribute",
  schema: "app",
  type: "composite_t",
  name,
});

const action = (overrides: Partial<Action> = {}): Action => ({
  sql: 'DROP TABLE "app"."old"',
  verb: "drop",
  produces: [],
  consumes: [],
  destroys: [relation("table")],
  releases: [],
  transactionality: "transactional",
  lockClass: "accessExclusive",
  newSegmentBefore: false,
  dataLoss: "none",
  rewriteRisk: false,
  ...overrides,
});

describe("destruction metadata integrity", () => {
  test("rejects intrinsically data-bearing destruction marked dataLoss:none", () => {
    expect(
      findDestructionMetadataViolations([
        action(),
        action({ destroys: [relation("materializedView", "mv")] }),
        action({ destroys: [column()] }),
        action({ destroys: [typeAttribute()] }),
      ]),
    ).toEqual([
      {
        actionIndex: 0,
        relation: { kind: "table", schema: "app", name: "old" },
      },
      {
        actionIndex: 1,
        relation: {
          kind: "materializedView",
          schema: "app",
          name: "mv",
        },
      },
      {
        actionIndex: 2,
        relation: {
          kind: "column",
          schema: "app",
          table: "t",
          name: "old_column",
        },
      },
      {
        actionIndex: 3,
        relation: {
          kind: "typeAttribute",
          schema: "app",
          type: "composite_t",
          name: "old_attribute",
        },
      },
    ]);
  });

  test("allows declared destruction and accepted same-action same-kind renames", () => {
    expect(
      findDestructionMetadataViolations([action({ dataLoss: "destructive" })]),
    ).toEqual([]);

    const from = relation("materializedView");
    const to = relation("materializedView", "new");
    expect(
      findDestructionMetadataViolations(
        [action({ verb: "alter", destroys: [from], produces: [to] })],
        [{ from, to }],
      ),
    ).toEqual([]);

    const oldColumn = column();
    const newColumn = column("new_column");
    const oldAttribute = typeAttribute();
    const newAttribute = typeAttribute("new_attribute");
    expect(
      findDestructionMetadataViolations(
        [
          action({
            verb: "alter",
            destroys: [oldColumn],
            produces: [newColumn],
          }),
          action({
            verb: "alter",
            destroys: [oldAttribute],
            produces: [newAttribute],
          }),
        ],
        [
          { from: oldColumn, to: newColumn },
          { from: oldAttribute, to: newAttribute },
        ],
      ),
    ).toEqual([]);
  });

  test("does not exempt cross-kind, cross-action, or merely declared renames", () => {
    const from = relation("table");
    const to = relation("table", "new");
    expect(
      findDestructionMetadataViolations(
        [action(), action({ verb: "alter", destroys: [], produces: [to] })],
        [{ from, to }],
      ),
    ).toHaveLength(1);
    expect(
      findDestructionMetadataViolations(
        [
          action({
            verb: "alter",
            produces: [relation("materializedView", "new")],
          }),
        ],
        [
          {
            from,
            to: relation("materializedView", "new"),
          },
        ],
      ),
    ).toHaveLength(1);
  });

  test("does not exempt a cross-kind subobject rename", () => {
    const from = column();
    const to = typeAttribute();
    expect(
      findDestructionMetadataViolations(
        [action({ verb: "alter", destroys: [from], produces: [to] })],
        [{ from, to }],
      ),
    ).toHaveLength(1);
  });

  test("does not classify non-data stable IDs as intrinsically destructive", () => {
    expect(
      findDestructionMetadataViolations([
        action({
          destroys: [
            { kind: "sequence", schema: "app", name: "seq" },
            { kind: "constraint", schema: "app", table: "t", name: "t_pkey" },
            { kind: "view", schema: "app", name: "v" },
          ],
        }),
      ]),
    ).toEqual([]);
  });
});
