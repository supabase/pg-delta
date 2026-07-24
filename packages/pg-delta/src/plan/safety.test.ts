import { describe, expect, test } from "bun:test";
import { buildFactBase, type Fact } from "../core/fact.ts";
import type { StableId } from "../core/stable-id.ts";
import { plan, type Action, type Plan } from "./plan.ts";
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

function generatedRenamePlan(sourceFacts: Fact[], desiredFacts: Fact[]): Plan {
  return plan(buildFactBase(sourceFacts, []), buildFactBase(desiredFacts, []), {
    renames: "auto",
    compact: false,
  });
}

const schemaFact: Fact = {
  id: { kind: "schema", name: "app" },
  payload: {},
};

function relationFacts(
  kind: "view" | "materializedView" | "foreignTable",
  name: string,
): Fact[] {
  const root: StableId = { kind, schema: "app", name };
  const payload =
    kind === "foreignTable"
      ? { server: "remote", options: [] }
      : { def: " SELECT 1 AS payload;", reloptions: null };
  return [
    { id: root, parent: schemaFact.id, payload },
    {
      id: {
        kind: "column",
        schema: "app",
        table: name,
        name: "payload",
      },
      parent: root,
      payload: { type: "integer", notNull: false },
    },
  ];
}

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

  test("does not let a separate action borrow an accepted ancestor rename", () => {
    const oldSchema = { kind: "schema" as const, name: "old_app" };
    const newSchema = { kind: "schema" as const, name: "new_app" };
    const oldTable = {
      kind: "table" as const,
      schema: "old_app",
      name: "records",
    };
    const newTable = { ...oldTable, schema: "new_app" };

    expect(
      findDestructionMetadataViolations(
        [
          action({
            verb: "alter",
            destroys: [oldSchema],
            produces: [newSchema],
          }),
          action({
            verb: "alter",
            destroys: [oldTable],
            produces: [newTable],
          }),
        ],
        [{ from: oldSchema, to: newSchema }],
      ),
    ).toEqual([{ actionIndex: 1, relation: oldTable }]);
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

  test("accepts generated metadata-only drops whose child IDs die with the parent", () => {
    const composite: StableId = {
      kind: "type",
      schema: "app",
      name: "record_t",
    };
    const sourceFacts: Fact[] = [
      schemaFact,
      ...relationFacts("view", "old_view"),
      ...relationFacts("foreignTable", "old_foreign"),
      {
        id: composite,
        parent: schemaFact.id,
        payload: { variant: "composite" },
      },
      {
        id: {
          kind: "typeAttribute",
          schema: "app",
          type: "record_t",
          name: "payload",
        },
        parent: composite,
        payload: { type: "integer", collation: null, _position: 1 },
      },
    ];
    const generated = generatedRenamePlan(sourceFacts, [schemaFact]);
    const drops = generated.actions.filter((candidate) =>
      /DROP (VIEW|FOREIGN TABLE|TYPE)/.test(candidate.sql),
    );

    expect(drops).toHaveLength(3);
    expect(drops.map((drop) => drop.dataLoss)).toEqual([
      "none",
      "none",
      "none",
    ]);
    expect(findDestructionMetadataViolations(drops)).toEqual([]);
  });

  test("generated standalone child drops remain explicitly destructive", () => {
    const table: StableId = { kind: "table", schema: "app", name: "records" };
    const composite: StableId = {
      kind: "type",
      schema: "app",
      name: "record_t",
    };
    const columnFact: Fact = {
      id: { kind: "column", schema: "app", table: "records", name: "gone" },
      parent: table,
      payload: { type: "integer" },
    };
    const attributeFact: Fact = {
      id: {
        kind: "typeAttribute",
        schema: "app",
        type: "record_t",
        name: "gone",
      },
      parent: composite,
      payload: { type: "integer", collation: null, _position: 1 },
    };
    const roots: Fact[] = [
      schemaFact,
      { id: table, parent: schemaFact.id, payload: {} },
      {
        id: composite,
        parent: schemaFact.id,
        payload: { variant: "composite" },
      },
    ];
    const generated = generatedRenamePlan(
      [...roots, columnFact, attributeFact],
      roots,
    );
    const drops = generated.actions.filter(
      (candidate) =>
        candidate.sql.includes("DROP COLUMN") ||
        candidate.sql.includes("DROP ATTRIBUTE"),
    );

    expect(drops).toHaveLength(2);
    expect(drops.map((drop) => drop.dataLoss)).toEqual([
      "destructive",
      "destructive",
    ]);
    expect(findDestructionMetadataViolations(drops)).toEqual([]);
  });

  test("accepts generated relation renames that carry their column subtree", () => {
    for (const kind of ["view", "materializedView", "foreignTable"] as const) {
      const generated = generatedRenamePlan(
        [schemaFact, ...relationFacts(kind, "old_relation")],
        [schemaFact, ...relationFacts(kind, "new_relation")],
      );

      expect(generated.acceptedRenames).toEqual([
        {
          from: { kind, schema: "app", name: "old_relation" },
          to: { kind, schema: "app", name: "new_relation" },
        },
      ]);
      expect(
        findDestructionMetadataViolations(
          generated.actions,
          generated.acceptedRenames,
        ),
      ).toEqual([]);
    }
  });

  test("accepts a generated table rename that preserves its column subtree", () => {
    const schema = { kind: "schema" as const, name: "app" };
    const oldTable = {
      kind: "table" as const,
      schema: "app",
      name: "old_t",
    };
    const newTable = { ...oldTable, name: "new_t" };
    const oldColumn = {
      kind: "column" as const,
      schema: "app",
      table: "old_t",
      name: "payload",
    };
    const newColumn = { ...oldColumn, table: "new_t" };
    const generated = generatedRenamePlan(
      [
        { id: schema, payload: {} },
        { id: oldTable, parent: schema, payload: {} },
        { id: oldColumn, parent: oldTable, payload: {} },
      ],
      [
        { id: schema, payload: {} },
        { id: newTable, parent: schema, payload: {} },
        { id: newColumn, parent: newTable, payload: {} },
      ],
    );

    expect(generated.acceptedRenames).toEqual([
      { from: oldTable, to: newTable },
    ]);
    expect(
      findDestructionMetadataViolations(
        generated.actions,
        generated.acceptedRenames,
      ),
    ).toEqual([]);
  });

  test("accepts a generated schema rename that preserves data-bearing descendants", () => {
    const oldSchema = { kind: "schema" as const, name: "old_app" };
    const newSchema = { kind: "schema" as const, name: "new_app" };
    const oldTable = {
      kind: "table" as const,
      schema: "old_app",
      name: "records",
    };
    const newTable = { ...oldTable, schema: "new_app" };
    const oldColumn = {
      kind: "column" as const,
      schema: "old_app",
      table: "records",
      name: "payload",
    };
    const newColumn = { ...oldColumn, schema: "new_app" };
    const oldMatview = {
      kind: "materializedView" as const,
      schema: "old_app",
      name: "summary",
    };
    const newMatview = { ...oldMatview, schema: "new_app" };
    const generated = generatedRenamePlan(
      [
        { id: oldSchema, payload: {} },
        { id: oldTable, parent: oldSchema, payload: {} },
        { id: oldColumn, parent: oldTable, payload: {} },
        { id: oldMatview, parent: oldSchema, payload: {} },
      ],
      [
        { id: newSchema, payload: {} },
        { id: newTable, parent: newSchema, payload: {} },
        { id: newColumn, parent: newTable, payload: {} },
        { id: newMatview, parent: newSchema, payload: {} },
      ],
    );

    expect(generated.acceptedRenames).toEqual([
      { from: oldSchema, to: newSchema },
    ]);
    expect(
      findDestructionMetadataViolations(
        generated.actions,
        generated.acceptedRenames,
      ),
    ).toEqual([]);
  });

  test("accepts a generated composite-type rename that preserves its attributes", () => {
    const schema = { kind: "schema" as const, name: "app" };
    const oldType = {
      kind: "type" as const,
      schema: "app",
      name: "old_record",
    };
    const newType = { ...oldType, name: "new_record" };
    const oldAttribute = {
      kind: "typeAttribute" as const,
      schema: "app",
      type: "old_record",
      name: "payload",
    };
    const newAttribute = { ...oldAttribute, type: "new_record" };
    const generated = generatedRenamePlan(
      [
        { id: schema, payload: {} },
        { id: oldType, parent: schema, payload: {} },
        { id: oldAttribute, parent: oldType, payload: {} },
      ],
      [
        { id: schema, payload: {} },
        { id: newType, parent: schema, payload: {} },
        { id: newAttribute, parent: newType, payload: {} },
      ],
    );

    expect(generated.acceptedRenames).toEqual([{ from: oldType, to: newType }]);
    expect(
      findDestructionMetadataViolations(
        generated.actions,
        generated.acceptedRenames,
      ),
    ).toEqual([]);
  });
});
