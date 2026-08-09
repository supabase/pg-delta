/**
 * A subscription reconstructed from a REDACTED extraction has a placeholder
 * conninfo (real host/credentials are unrecoverable) but keeps `enabled=true`.
 * Emitting the `ALTER SUBSCRIPTION … ENABLE` follow-up starts a replication
 * worker against a bogus host that fails asynchronously forever, while catalog
 * convergence still passes. The redacted CREATE must therefore stay DISABLED
 * and surface a note telling the operator to set a real CONNECTION and enable
 * it manually. Unredacted enabled creates are unchanged. Pure rule/plan level —
 * no DB.
 */
import { describe, expect, test } from "bun:test";
import { buildFactBase, type Fact } from "../../core/fact.ts";
import type { StableId } from "../../core/stable-id.ts";
import { SUBSCRIPTION_CONNINFO_PLACEHOLDER } from "../../extract/sensitive-options.ts";
import { plan } from "../plan.ts";

const subId: StableId = { kind: "subscription", name: "s" };

const subFact = (overrides: Record<string, unknown> = {}): Fact => ({
  id: subId,
  payload: {
    _serverMajor: 18,
    enabled: true,
    conninfo: "dbname=app host=real.example.com user=repl password=hunter2",
    slotName: null,
    publications: ["p"],
    binary: false,
    streaming: "off",
    synchronousCommit: "off",
    disableOnError: false,
    twoPhase: false,
    runAsOwner: false,
    origin: "any",
    ...overrides,
  },
});

const createActions = (fact: Fact): string[] =>
  plan(buildFactBase([], []), buildFactBase([fact], [])).actions.map(
    (a) => a.sql,
  );

const twoPhaseAlter = (from: Fact, to: Fact): string[] =>
  plan(buildFactBase([from], []), buildFactBase([to], [])).actions.map(
    (a) => a.sql,
  );

describe("subscription create redaction gate", () => {
  test("an unredacted enabled subscription still emits the ENABLE follow-up", () => {
    const sqls = createActions(subFact());
    expect(sqls.some((s) => s.startsWith(`CREATE SUBSCRIPTION "s"`))).toBe(
      true,
    );
    expect(sqls).toContain(`ALTER SUBSCRIPTION "s" ENABLE`);
  });

  test("a redacted (placeholder-conninfo) enabled subscription stays disabled with a note", () => {
    const sqls = createActions(
      subFact({ conninfo: SUBSCRIPTION_CONNINFO_PLACEHOLDER }),
    );
    const create = sqls.find((s) => s.includes(`CREATE SUBSCRIPTION "s"`));
    expect(create).toBeDefined();
    // no worker is started against the bogus placeholder host
    expect(sqls).not.toContain(`ALTER SUBSCRIPTION "s" ENABLE`);
    // and the operator is told what to do
    expect(create).toMatch(/redacted/i);
    expect(create).toMatch(/ENABLE/);
  });
});

describe("subscription two_phase change is not a destructive replace", () => {
  test("on PG18+ it alters in place (DISABLE → SET), never DROP/CREATE", () => {
    const sqls = twoPhaseAlter(
      subFact({ _serverMajor: 18, enabled: false, twoPhase: false }),
      subFact({ _serverMajor: 18, enabled: false, twoPhase: true }),
    );
    expect(sqls.some((s) => s.startsWith("DROP SUBSCRIPTION"))).toBe(false);
    expect(sqls.some((s) => s.startsWith("CREATE SUBSCRIPTION"))).toBe(false);
    expect(sqls).toContain(`ALTER SUBSCRIPTION "s" DISABLE`);
    expect(sqls).toContain(`ALTER SUBSCRIPTION "s" SET (two_phase = true)`);
  });

  test("re-enables afterward when the desired state is enabled", () => {
    const sqls = twoPhaseAlter(
      subFact({ _serverMajor: 18, enabled: true, twoPhase: false }),
      subFact({ _serverMajor: 18, enabled: true, twoPhase: true }),
    );
    // DISABLE and ENABLE bracket the SET, in emission order.
    expect(sqls).toContain(`ALTER SUBSCRIPTION "s" ENABLE`);
    const dis = sqls.indexOf(`ALTER SUBSCRIPTION "s" DISABLE`);
    const set = sqls.indexOf(`ALTER SUBSCRIPTION "s" SET (two_phase = true)`);
    const en = sqls.indexOf(`ALTER SUBSCRIPTION "s" ENABLE`);
    expect(dis).toBeGreaterThanOrEqual(0);
    expect(dis).toBeLessThan(set);
    expect(set).toBeLessThan(en);
  });

  test("on PG < 18 it fails loudly at plan time instead of dropping the slot", () => {
    expect(() =>
      twoPhaseAlter(
        subFact({ _serverMajor: 17, twoPhase: false }),
        subFact({ _serverMajor: 17, twoPhase: true }),
      ),
    ).toThrow(/two_phase requires PostgreSQL 18/);
  });
});
