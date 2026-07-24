import { describe, expect, test } from "bun:test";
import type { StableId } from "../core/stable-id.ts";
import type { Action } from "./plan.ts";
import { findDestructionMetadataViolations } from "./safety.ts";

const relation = (
  kind: "table" | "materializedView",
  name = "old",
): StableId => ({ kind, schema: "app", name });

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
  test("rejects table and materialized-view destruction marked dataLoss:none", () => {
    expect(
      findDestructionMetadataViolations([
        action(),
        action({ destroys: [relation("materializedView", "mv")] }),
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
    ]);
  });

  test("allows declared destruction and an accepted same-action same-kind rename", () => {
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
});
