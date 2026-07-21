/**
 * CREATE / ALTER SUBSCRIPTION must carry the full pg_subscription option set
 * (PR #299 review, supabase/pg-toolbelt). The payload only held
 * enabled/conninfo/slotName/publications, so binary / streaming /
 * synchronous_commit / disable_on_error / run_as_owner / two_phase / origin
 * were never captured — a subscription that differed only in those options
 * hashed identically and planned nothing. Pure rule/diff level — no DB; the
 * corpus needs a live publisher, so the SQL shape is proven here.
 */
import { describe, expect, test } from "bun:test";
import { buildFactBase, type Fact } from "../core/fact.ts";
import type { StableId } from "../core/stable-id.ts";
import { plan } from "./plan.ts";

const subId: StableId = { kind: "subscription", name: "s" };
const subFact = (extra: Record<string, unknown>): Fact => ({
  id: subId,
  payload: {
    _serverMajor: 18,
    enabled: false,
    conninfo: "host=localhost dbname=postgres",
    slotName: null,
    publications: ["pub"],
    binary: false,
    streaming: "off",
    synchronousCommit: "off",
    disableOnError: false,
    runAsOwner: false,
    twoPhase: false,
    origin: "any",
    ...extra,
  },
});
const base = (extra: Fact[]) => buildFactBase(extra, []);

describe("subscription option rendering", () => {
  test("create renders the extended option set in the WITH clause", () => {
    const sql = plan(
      base([]),
      base([
        subFact({
          binary: true,
          streaming: "parallel",
          synchronousCommit: "local",
          disableOnError: true,
          runAsOwner: true,
          twoPhase: true,
          origin: "none",
        }),
      ]),
    )
      .actions.map((a) => a.sql)
      .join("\n");
    expect(sql).toContain("binary = true");
    expect(sql).toContain("streaming = 'parallel'");
    expect(sql).toContain("synchronous_commit = 'local'");
    expect(sql).toContain("disable_on_error = true");
    expect(sql).toContain("run_as_owner = true");
    expect(sql).toContain("two_phase = true");
    expect(sql).toContain("origin = 'none'");
  });

  test("create omits version-gated options that were not captured (null)", () => {
    const sql = plan(
      base([]),
      base([subFact({ runAsOwner: null, origin: null })]),
    )
      .actions.map((a) => a.sql)
      .join("\n");
    expect(sql).not.toContain("run_as_owner");
    expect(sql).not.toContain("origin");
  });

  test("a binary-only change is an in-place ALTER SET", () => {
    const sql = plan(
      base([subFact({ binary: false })]),
      base([subFact({ binary: true })]),
    ).actions.map((a) => a.sql);
    expect(sql).toContain(`ALTER SUBSCRIPTION "s" SET (binary = true)`);
  });

  test("streaming / synchronous_commit / disable_on_error / run_as_owner / origin alter in place", () => {
    const sql = plan(
      base([subFact({})]),
      base([
        subFact({
          streaming: "parallel",
          synchronousCommit: "remote_apply",
          disableOnError: true,
          runAsOwner: true,
          origin: "none",
        }),
      ]),
    ).actions.map((a) => a.sql);
    expect(sql).toContain(
      `ALTER SUBSCRIPTION "s" SET (streaming = 'parallel')`,
    );
    expect(sql).toContain(
      `ALTER SUBSCRIPTION "s" SET (synchronous_commit = 'remote_apply')`,
    );
    expect(sql).toContain(
      `ALTER SUBSCRIPTION "s" SET (disable_on_error = true)`,
    );
    expect(sql).toContain(`ALTER SUBSCRIPTION "s" SET (run_as_owner = true)`);
    expect(sql).toContain(`ALTER SUBSCRIPTION "s" SET (origin = 'none')`);
  });

  test("a two_phase change alters in place on PG18+ (no destructive recreate)", () => {
    // Recreating drops the publisher's replication slot; the PG18+ in-place
    // ALTER SET (two_phase) preserves it (see rules/publications.ts and the
    // subscription-two-phase integration test).
    const sql = plan(
      base([subFact({ twoPhase: false })]),
      base([subFact({ twoPhase: true })]),
    ).actions.map((a) => a.sql);
    expect(sql.some((s) => s.startsWith("DROP SUBSCRIPTION"))).toBe(false);
    expect(sql.some((s) => s.startsWith("CREATE SUBSCRIPTION"))).toBe(false);
    expect(sql).toContain(`ALTER SUBSCRIPTION "s" SET (two_phase = true)`);
  });
});
