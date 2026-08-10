/**
 * Unit tests for the pg_partman handler (docs/architecture/extension-intent.md
 * §3.3, CLI-2044). No database — a fake `HandlerContext` returns canned rows
 * keyed off the SQL the handler issues. Covers: the Phase-A `managedBy` walk
 * (unchanged), the Phase-B `part_config` intent capture (fact shape, payload
 * split, depends edge, auto-created template-table tagging), the
 * sub-partitioning `INTENT_UNSUPPORTED` scope-out, and the `intentKinds.parent`
 * create/drop rendering.
 */
import { describe, expect, test } from "bun:test";
import { INTENT_UNSUPPORTED } from "../../core/diagnostic.ts";
import { buildFactBase, type Fact } from "../../core/fact.ts";
import type { HandlerContext } from "../../extract/handler.ts";
import type { Row } from "../../extract/scope.ts";
import type { StableId } from "../../core/stable-id.ts";
import { pgPartmanHandler } from "./pg-partman.ts";

const PG_PARTMAN: StableId = { kind: "extension", name: "pg_partman" };
const partmanFact: Fact = { id: PG_PARTMAN, payload: {} };

const tableId = (schema: string, name: string): StableId => ({
  kind: "table",
  schema,
  name,
});
const tableFact = (schema: string, name: string): Fact => ({
  id: tableId(schema, name),
  payload: {},
});

const parentIntentId = (key: string): StableId => ({
  kind: "extensionIntent",
  ext: "pg_partman",
  intentKind: "parent",
  key,
});

/** One `part_config` row as the handler's capture query projects it. */
interface ConfigRow {
  parent_schema: string;
  parent_name: string;
  control: string;
  partition_interval: string;
  partition_type: string;
  epoch: string;
  premake: number;
  automatic_maintenance: string;
  constraint_cols: string[] | null;
  template_schema: string | null;
  template_name: string | null;
  jobmon: boolean;
  date_trunc_interval: string | null;
  time_encoder: string | null;
  time_decoder: string | null;
  default_table: boolean;
  retention: string | null;
  retention_schema: string | null;
  retention_keep_index: boolean;
  retention_keep_table: boolean;
  retention_keep_publication: boolean;
  optimize_constraint: number;
  infinite_time_partitions: boolean;
  inherit_privileges: boolean;
  constraint_valid: boolean;
  ignore_default_data: boolean;
  maintenance_order: number | null;
  is_sub_partition_set: boolean;
  is_sub_partition_child: boolean;
}

/** A `part_config` row with partman 5.3.1's own defaults, plus the auto-created
 *  template table partman names `template_<parent_schema>_<parent_name>`. */
const config = (
  overrides: Partial<ConfigRow> & {
    parent_schema: string;
    parent_name: string;
  },
): ConfigRow => ({
  control: "created_at",
  partition_interval: "1 day",
  partition_type: "range",
  epoch: "none",
  premake: 4,
  automatic_maintenance: "on",
  constraint_cols: null,
  template_schema: "partman",
  template_name: `template_${overrides.parent_schema}_${overrides.parent_name}`,
  jobmon: true,
  date_trunc_interval: null,
  time_encoder: null,
  time_decoder: null,
  default_table: true,
  retention: null,
  retention_schema: null,
  retention_keep_index: true,
  retention_keep_table: true,
  retention_keep_publication: false,
  optimize_constraint: 30,
  infinite_time_partitions: false,
  inherit_privileges: false,
  constraint_valid: true,
  ignore_default_data: true,
  maintenance_order: null,
  is_sub_partition_set: false,
  is_sub_partition_child: false,
  ...overrides,
});

/** A row of the Phase-A `pg_inherits` descendant walk. */
interface ChildRow {
  schema: string;
  name: string;
}

/** Build a fake ctx: detect() returns partman's install schema (or no rows when
 *  the extension is absent); the descendant walk and the part_config projection
 *  return the supplied rows. */
function fakeCtx(
  rows: { children?: ChildRow[]; configs?: ConfigRow[] },
  installed = true,
): HandlerContext {
  return {
    query: async (sql: string): Promise<Row[]> => {
      if (/pg_extension/i.test(sql)) {
        return installed ? [{ schema: "partman" }] : [];
      }
      if (/descendants\b/i.test(sql) && !/part_config_sub/i.test(sql)) {
        return (rows.children ?? []) as unknown as Row[];
      }
      if (/part_config\b/i.test(sql)) {
        return (rows.configs ?? []) as unknown as Row[];
      }
      throw new Error(`fakeCtx: unexpected query: ${sql}`);
    },
  };
}

describe("pgPartmanHandler.capture", () => {
  test("not installed → no facts, no edges", async () => {
    const ctx = fakeCtx({}, false);
    const current = buildFactBase([], []);
    const result = await pgPartmanHandler.capture(ctx, current);
    expect(result.facts).toEqual([]);
    expect(result.edges).toEqual([]);
  });

  test("installed with no registered parent → no facts, no edges", async () => {
    const ctx = fakeCtx({});
    const current = buildFactBase([partmanFact], []);
    const result = await pgPartmanHandler.capture(ctx, current);
    expect(result.facts).toEqual([]);
    expect(result.edges).toEqual([]);
  });

  // ── Phase A (unchanged behaviour) ────────────────────────────────────────
  test("Phase A: every pg_inherits descendant of a registered parent is tagged managedBy", async () => {
    const ctx = fakeCtx({
      children: [
        { schema: "public", name: "events_default" },
        { schema: "public", name: "events_p20260101" },
      ],
    });
    const current = buildFactBase(
      [
        partmanFact,
        tableFact("public", "events"),
        tableFact("public", "events_default"),
        tableFact("public", "events_p20260101"),
      ],
      [],
    );

    const result = await pgPartmanHandler.capture(ctx, current);

    expect(result.edges.filter((e) => e.kind === "managedBy")).toEqual([
      {
        from: tableId("public", "events_default"),
        to: PG_PARTMAN,
        kind: "managedBy",
      },
      {
        from: tableId("public", "events_p20260101"),
        to: PG_PARTMAN,
        kind: "managedBy",
      },
    ]);
  });

  test("Phase A: a child that is not a fact produces no dangling managedBy edge", async () => {
    const ctx = fakeCtx({
      children: [
        { schema: "public", name: "events_default" },
        { schema: "public", name: "events_p20260101" },
      ],
    });
    const current = buildFactBase(
      [partmanFact, tableFact("public", "events_default")],
      [],
    );

    const result = await pgPartmanHandler.capture(ctx, current);

    expect(result.edges.filter((e) => e.kind === "managedBy")).toEqual([
      {
        from: tableId("public", "events_default"),
        to: PG_PARTMAN,
        kind: "managedBy",
      },
    ]);
  });

  // ── Phase B: part_config intent capture ──────────────────────────────────
  test("a registered parent becomes one intent fact keyed by <schema>.<name>", async () => {
    const ctx = fakeCtx({
      configs: [config({ parent_schema: "public", parent_name: "events" })],
    });
    const current = buildFactBase(
      [partmanFact, tableFact("public", "events")],
      [],
    );

    const result = await pgPartmanHandler.capture(ctx, current);

    expect(result.facts).toHaveLength(1);
    expect(result.facts[0]?.id).toEqual(parentIntentId("public.events"));
    expect(result.facts[0]?.payload).toEqual({
      partmanSchema: "partman",
      control: "created_at",
      partitionInterval: "1 day",
      partitionType: "range",
      epoch: "none",
      premake: 4,
      automaticMaintenance: "on",
      constraintCols: null,
      templateTable: null,
      jobmon: true,
      dateTruncInterval: null,
      timeEncoder: null,
      timeDecoder: null,
      defaultTable: true,
      retention: null,
      retentionSchema: null,
      retentionKeepIndex: true,
      retentionKeepTable: true,
      retentionKeepPublication: false,
      optimizeConstraint: 30,
      infiniteTimePartitions: false,
      inheritPrivileges: false,
      constraintValid: true,
      ignoreDefaultData: true,
      maintenanceOrder: null,
    });
  });

  test("each intent fact carries a depends edge on the pg_partman extension fact", async () => {
    const ctx = fakeCtx({
      configs: [
        config({ parent_schema: "public", parent_name: "events" }),
        config({ parent_schema: "app", parent_name: "logs" }),
      ],
    });
    const current = buildFactBase(
      [partmanFact, tableFact("public", "events"), tableFact("app", "logs")],
      [],
    );

    const result = await pgPartmanHandler.capture(ctx, current);

    expect(result.edges.filter((e) => e.kind === "depends")).toEqual([
      {
        from: parentIntentId("public.events"),
        to: PG_PARTMAN,
        kind: "depends",
      },
      { from: parentIntentId("app.logs"), to: PG_PARTMAN, kind: "depends" },
    ]);
  });

  test("depends edge is guarded by current.has(pg_partman) — omitted when the extension fact is absent", async () => {
    const ctx = fakeCtx({
      configs: [config({ parent_schema: "public", parent_name: "events" })],
    });
    const current = buildFactBase([], []);
    const result = await pgPartmanHandler.capture(ctx, current);
    expect(result.facts).toHaveLength(1);
    expect(result.edges.filter((e) => e.kind === "depends")).toEqual([]);
  });

  test("partman's AUTO-created template table is tagged managedBy and the payload records templateTable: null", async () => {
    const ctx = fakeCtx({
      configs: [config({ parent_schema: "public", parent_name: "events" })],
    });
    const current = buildFactBase(
      [
        partmanFact,
        tableFact("public", "events"),
        tableFact("partman", "template_public_events"),
      ],
      [],
    );

    const result = await pgPartmanHandler.capture(ctx, current);

    const payload = result.facts[0]?.payload as
      | { templateTable: unknown }
      | undefined;
    expect(payload?.templateTable).toBeNull();
    expect(result.edges.filter((e) => e.kind === "managedBy")).toEqual([
      {
        from: tableId("partman", "template_public_events"),
        to: PG_PARTMAN,
        kind: "managedBy",
      },
    ]);
  });

  test("a USER-supplied template table stays a user fact and lands in the payload", async () => {
    const ctx = fakeCtx({
      configs: [
        config({
          parent_schema: "public",
          parent_name: "events",
          template_schema: "public",
          template_name: "my_template",
        }),
      ],
    });
    const current = buildFactBase(
      [
        partmanFact,
        tableFact("public", "events"),
        tableFact("public", "my_template"),
      ],
      [],
    );

    const result = await pgPartmanHandler.capture(ctx, current);

    const payload = result.facts[0]?.payload as
      | { templateTable: unknown }
      | undefined;
    expect(payload?.templateTable).toEqual({
      schema: "public",
      name: "my_template",
    });
    // NOT managed: the user declared it, so it must keep diffing normally
    expect(result.edges.filter((e) => e.kind === "managedBy")).toEqual([]);
  });

  test("a sub-partitioned parent emits no fact and one INTENT_UNSUPPORTED warning", async () => {
    const ctx = fakeCtx({
      configs: [
        config({
          parent_schema: "public",
          parent_name: "events",
          is_sub_partition_set: true,
        }),
        config({ parent_schema: "app", parent_name: "logs" }),
      ],
    });
    const current = buildFactBase(
      [partmanFact, tableFact("public", "events"), tableFact("app", "logs")],
      [],
    );

    const result = await pgPartmanHandler.capture(ctx, current);

    expect(result.facts.map((f) => (f.id as { key: string }).key)).toEqual([
      "app.logs",
    ]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics?.[0]?.code).toBe(INTENT_UNSUPPORTED);
    expect(result.diagnostics?.[0]?.severity).toBe("warning");
    expect(result.diagnostics?.[0]?.message).toMatch(/public\.events/);
    expect(result.diagnostics?.[0]?.context).toEqual({
      ext: "pg_partman",
      intentKind: "parent",
    });
  });

  test("a partman-created SUB-parent (a child that is itself registered) emits no fact and one warning", async () => {
    const ctx = fakeCtx({
      configs: [
        config({
          parent_schema: "public",
          parent_name: "events_p2026",
          is_sub_partition_child: true,
        }),
      ],
    });
    const current = buildFactBase([partmanFact], []);

    const result = await pgPartmanHandler.capture(ctx, current);

    expect(result.facts).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics?.[0]?.code).toBe(INTENT_UNSUPPORTED);
  });
});

describe("pgPartmanHandler.intentKinds.parent", () => {
  const parentRule = pgPartmanHandler.intentKinds?.["parent"];

  const payload = (overrides: Record<string, unknown> = {}) => ({
    partmanSchema: "partman",
    control: "created_at",
    partitionInterval: "1 day",
    partitionType: "range",
    epoch: "none",
    premake: 4,
    automaticMaintenance: "on",
    constraintCols: null,
    templateTable: null,
    jobmon: true,
    dateTruncInterval: null,
    timeEncoder: null,
    timeDecoder: null,
    defaultTable: true,
    retention: null,
    retentionSchema: null,
    retentionKeepIndex: true,
    retentionKeepTable: true,
    retentionKeepPublication: false,
    optimizeConstraint: 30,
    infiniteTimePartitions: false,
    inheritPrivileges: false,
    constraintValid: true,
    ignoreDefaultData: true,
    maintenanceOrder: null,
    ...overrides,
  });

  const parentFact = (
    key: string,
    overrides: Record<string, unknown> = {},
  ): Fact => ({
    id: parentIntentId(key),
    payload: payload(overrides),
  });

  test("payloadAttrs covers EVERY captured payload key (no silent drift hole)", () => {
    expect([...(parentRule?.payloadAttrs ?? [])].sort()).toEqual(
      Object.keys(payload()).sort(),
    );
  });

  test("create: a default-shaped parent renders one create_parent call, no part_config UPDATE", () => {
    const actions = parentRule?.create(
      parentFact("public.events"),
      undefined as never,
    );
    expect(actions).toHaveLength(1);
    expect(actions?.[0]?.sql).toMatchInlineSnapshot(
      `"select "partman".create_parent(p_parent_table := 'public.events', p_control := 'created_at', p_interval := '1 day', p_type := 'range', p_epoch := 'none', p_premake := 4, p_default_table := true, p_automatic_maintenance := 'on', p_constraint_cols := NULL, p_jobmon := true, p_date_trunc_interval := NULL, p_control_not_null := false, p_time_encoder := NULL, p_time_decoder := NULL)"`,
    );
  });

  test("create: the call CONSUMES the parent table so it orders after CREATE TABLE", () => {
    const actions = parentRule?.create(
      parentFact("public.events"),
      undefined as never,
    );
    expect(actions?.[0]?.consumes).toEqual([
      { kind: "table", schema: "public", name: "events" },
    ]);
  });

  test("create: a user-supplied template table is passed AND consumed", () => {
    const actions = parentRule?.create(
      parentFact("public.events", {
        templateTable: { schema: "public", name: "my_template" },
      }),
      undefined as never,
    );
    expect(actions?.[0]?.sql).toMatchInlineSnapshot(
      `"select "partman".create_parent(p_parent_table := 'public.events', p_control := 'created_at', p_interval := '1 day', p_type := 'range', p_epoch := 'none', p_premake := 4, p_default_table := true, p_automatic_maintenance := 'on', p_constraint_cols := NULL, p_jobmon := true, p_date_trunc_interval := NULL, p_control_not_null := false, p_time_encoder := NULL, p_time_decoder := NULL, p_template_table := 'public.my_template')"`,
    );
    expect(actions?.[0]?.consumes).toEqual([
      { kind: "table", schema: "public", name: "events" },
      { kind: "table", schema: "public", name: "my_template" },
    ]);
  });

  test("create: non-default (b) columns add a second statement — an UPDATE of part_config", () => {
    const actions = parentRule?.create(
      parentFact("public.events", {
        retention: "3 months",
        retentionKeepTable: false,
        infiniteTimePartitions: true,
        optimizeConstraint: 10,
      }),
      undefined as never,
    );
    expect(actions).toHaveLength(2);
    expect(actions?.[1]?.sql).toMatchInlineSnapshot(
      `"update "partman".part_config set "retention" = '3 months', "retention_schema" = NULL, "retention_keep_index" = true, "retention_keep_table" = false, "retention_keep_publication" = false, "optimize_constraint" = 10, "infinite_time_partitions" = true, "inherit_privileges" = false, "constraint_valid" = true, "ignore_default_data" = true, "maintenance_order" = NULL where "parent_table" = 'public.events'"`,
    );
  });

  test("create: every non-default argument is rendered, and the partman schema is quoted", () => {
    const actions = parentRule?.create(
      parentFact("app.logs", {
        partmanSchema: "my partman",
        control: "ts",
        partitionInterval: "1 week",
        partitionType: "list",
        epoch: "seconds",
        premake: 10,
        automaticMaintenance: "off",
        constraintCols: ["a", "b"],
        jobmon: false,
        dateTruncInterval: "1 day",
        timeEncoder: "public.enc",
        timeDecoder: "public.dec",
        defaultTable: false,
      }),
      undefined as never,
    );
    expect(actions?.[0]?.sql).toMatchInlineSnapshot(
      `"select "my partman".create_parent(p_parent_table := 'app.logs', p_control := 'ts', p_interval := '1 week', p_type := 'list', p_epoch := 'seconds', p_premake := 10, p_default_table := false, p_automatic_maintenance := 'off', p_constraint_cols := ARRAY['a', 'b']::text[], p_jobmon := false, p_date_trunc_interval := '1 day', p_control_not_null := false, p_time_encoder := 'public.enc', p_time_decoder := 'public.dec')"`,
    );
  });

  test("drop: deregisters the parent and is NOT flagged destructive (no table is dropped)", () => {
    const action = parentRule?.drop(parentFact("public.events"));
    expect(action?.sql).toMatchInlineSnapshot(
      `"delete from "partman".part_config where "parent_table" = 'public.events'"`,
    );
    expect(action?.dataLoss ?? "none").toBe("none");
  });
});

describe("pgPartmanHandler shape", () => {
  test("declares the pg_partman extension", () => {
    expect(pgPartmanHandler.extension).toBe("pg_partman");
  });

  test("has NO shadowPrecheck — partman works in any database (unlike pg_cron)", () => {
    expect(pgPartmanHandler.shadowPrecheck).toBeUndefined();
  });
});
