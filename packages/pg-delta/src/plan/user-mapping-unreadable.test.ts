/**
 * Unit gate for the `USER_MAPPING_UNREADABLE` diagnostic (Codex P1 on PR
 * #338, follow-up to the non-superuser `pg_user_mappings` fallback in
 * src/extract/foreign.ts). Mirrors the `INTENT_UNKEYED` gate's test shape
 * (src/plan/intent-plan.test.ts) but with synthetic FactBases carrying a
 * `diagnostics` entry directly, rather than going through a real extraction —
 * no Docker needed.
 *
 * A skipped user-mapping fact means its true state is UNKNOWN on that side.
 * If the OTHER side's extraction COULD see the mapping, the missing fact
 * would otherwise read as an intentional add/remove and plan a wrong
 * CREATE/DROP USER MAPPING — plan() must refuse instead.
 */
import { describe, expect, test } from "bun:test";
import { USER_MAPPING_UNREADABLE } from "../core/diagnostic.ts";
import { buildFactBase, type Fact } from "../core/fact.ts";
import type { StableId } from "../core/stable-id.ts";
import { plan } from "./plan.ts";

const serverId: StableId = { kind: "server", name: "srv" };
const mappingId: StableId = {
  kind: "userMapping",
  server: "srv",
  role: "PUBLIC",
};

const serverFact: Fact = {
  id: serverId,
  payload: { fdw: "fdw1", type: null, version: null, options: [] },
};
const mappingFact: Fact = {
  id: mappingId,
  parent: serverId,
  payload: { options: [] },
};

describe("plan() — unreadable-user-mapping gate", () => {
  test("mapping visible on the desired side only (would-be CREATE) throws", () => {
    const source = buildFactBase([serverFact], []);
    source.diagnostics.push({
      code: USER_MAPPING_UNREADABLE,
      severity: "warning",
      subject: mappingId,
      message: "hidden on source",
    });
    const desired = buildFactBase([serverFact, mappingFact], []);

    expect(() => plan(source, desired)).toThrow(
      /user mappings is unknown on one side/,
    );
    expect(() => plan(source, desired)).toThrow(/srv\/PUBLIC/);
  });

  test("mapping visible on the source side only (would-be DROP) throws", () => {
    const source = buildFactBase([serverFact, mappingFact], []);
    const desired = buildFactBase([serverFact], []);
    desired.diagnostics.push({
      code: USER_MAPPING_UNREADABLE,
      severity: "warning",
      subject: mappingId,
      message: "hidden on desired",
    });

    expect(() => plan(source, desired)).toThrow(/srv\/PUBLIC/);
  });

  test("hidden on both sides — no delta touches it — does not throw", () => {
    const source = buildFactBase([serverFact], []);
    source.diagnostics.push({
      code: USER_MAPPING_UNREADABLE,
      severity: "warning",
      subject: mappingId,
      message: "hidden on source",
    });
    const desired = buildFactBase([serverFact], []);
    desired.diagnostics.push({
      code: USER_MAPPING_UNREADABLE,
      severity: "warning",
      subject: mappingId,
      message: "hidden on desired",
    });

    expect(() => plan(source, desired)).not.toThrow();
  });

  test("diagnostic present but the subject is untouched by any delta does not throw", () => {
    const source = buildFactBase([serverFact], []);
    source.diagnostics.push({
      code: USER_MAPPING_UNREADABLE,
      severity: "warning",
      subject: mappingId,
      message: "hidden on source",
    });
    const desired = buildFactBase([serverFact], []);

    expect(() => plan(source, desired)).not.toThrow();
  });
});

/**
 * Round 3 (Codex P2s, comments 3601826179 + 3601826182): a DROP of the
 * mapping's containing SERVER, or of its (non-PUBLIC) mapped ROLE, destroys
 * the hidden mapping too — CASCADE-style — without any delta ever naming the
 * mapping directly. Extends the gate to a `remove` delta on either. ALTERs /
 * owner changes must NOT be gated (over-blocking has no correctness benefit),
 * and a PUBLIC mapping's pseudo-"role" must never gate a real role's drop.
 */
describe("plan() — unreadable-user-mapping gate extends to server/role drops", () => {
  const roleId: StableId = { kind: "role", name: "mapped_role" };
  const roleFact: Fact = {
    id: roleId,
    payload: {
      superuser: false,
      inherit: true,
      createRole: false,
      createDb: false,
      login: false,
      replication: false,
      bypassRls: false,
      config: [],
    },
  };
  const roleMappingId: StableId = {
    kind: "userMapping",
    server: "srv2",
    role: "mapped_role",
  };

  test("plan would emit DROP SERVER for a server with a hidden child mapping — throws", () => {
    const source = buildFactBase([serverFact], []);
    source.diagnostics.push({
      code: USER_MAPPING_UNREADABLE,
      severity: "warning",
      subject: mappingId, // { server: "srv", role: "PUBLIC" }
      message: "hidden on source",
    });
    const desired = buildFactBase([], []);

    expect(() => plan(source, desired)).toThrow(
      /user mappings is unknown on one side/,
    );
    expect(() => plan(source, desired)).toThrow(/srv \(server/);
  });

  test("plan would emit DROP ROLE for a hidden mapping's mapped role — throws", () => {
    const source = buildFactBase([roleFact], []);
    source.diagnostics.push({
      code: USER_MAPPING_UNREADABLE,
      severity: "warning",
      subject: roleMappingId, // { server: "srv2", role: "mapped_role" }
      message: "hidden on source",
    });
    const desired = buildFactBase([], []);

    expect(() => plan(source, desired)).toThrow(
      /user mappings is unknown on one side/,
    );
    expect(() => plan(source, desired)).toThrow(/mapped_role \(role/);
  });

  test("a genuine in-place ALTER (version, non-replace) on that server does NOT throw", () => {
    // `version` has a real `alter` rule (rules/foreign.ts) — an in-place
    // `ALTER SERVER … VERSION …`, never a drop+create — so it must NOT be
    // gated (zero-over-block: it never touches the hidden mapping).
    const serverV1: Fact = {
      id: serverId,
      payload: { fdw: "fdw1", type: null, version: "1.0", options: [] },
    };
    const serverV2: Fact = {
      id: serverId,
      payload: { fdw: "fdw1", type: null, version: "2.0", options: [] },
    };
    const source = buildFactBase([serverV1], []);
    source.diagnostics.push({
      code: USER_MAPPING_UNREADABLE,
      severity: "warning",
      subject: mappingId, // { server: "srv", role: "PUBLIC" }
      message: "hidden on source",
    });
    const desired = buildFactBase([serverV2], []);

    expect(() => plan(source, desired)).not.toThrow();
  });

  test("a replace-class server change (type) with a hidden child mapping — throws", () => {
    // `server.attributes.type` is `"replace"` (rules/foreign.ts): there is no
    // in-place ALTER, so expandReplacements (runs AFTER this gate) turns this
    // `set` delta into DROP SERVER + CREATE SERVER — destroying the hidden
    // mapping's server exactly like an explicit DROP would. RED (before the
    // fix): plan() succeeded and the rendered plan contained "DROP SERVER".
    const serverV1: Fact = {
      id: serverId,
      payload: { fdw: "fdw1", type: "t1", version: null, options: [] },
    };
    const serverV2: Fact = {
      id: serverId,
      payload: { fdw: "fdw1", type: "t2", version: null, options: [] },
    };
    const source = buildFactBase([serverV1], []);
    source.diagnostics.push({
      code: USER_MAPPING_UNREADABLE,
      severity: "warning",
      subject: mappingId, // { server: "srv", role: "PUBLIC" }
      message: "hidden on source",
    });
    const desired = buildFactBase([serverV2], []);

    expect(() => plan(source, desired)).toThrow(
      /user mappings is unknown on one side/,
    );
    expect(() => plan(source, desired)).toThrow(/srv \(server.*replaced/);
  });

  test("a PUBLIC mapping's diagnostic does not gate an unrelated role's drop", () => {
    const unrelatedRoleId: StableId = { kind: "role", name: "unrelated_role" };
    const unrelatedRoleFact: Fact = {
      id: unrelatedRoleId,
      payload: {
        superuser: false,
        inherit: true,
        createRole: false,
        createDb: false,
        login: false,
        replication: false,
        bypassRls: false,
        config: [],
      },
    };
    const source = buildFactBase([unrelatedRoleFact], []);
    source.diagnostics.push({
      code: USER_MAPPING_UNREADABLE,
      severity: "warning",
      subject: mappingId, // { server: "srv", role: "PUBLIC" } — excluded
      message: "hidden on source",
    });
    const desired = buildFactBase([], []);

    expect(() => plan(source, desired)).not.toThrow();
  });
});

/**
 * Position-pinning (Codex P1, PR #338 comment 3603601149 — DOCUMENTED, NOT
 * gated; see the "KNOWN LIMITATION #2" comment in plan.ts). A desired-side
 * unreadable mapping whose containing server doesn't exist on the source at
 * all produces an un-gated `add` delta for the server; the un-creatable
 * CREATE USER MAPPING is simply never emitted (the mapping fact itself was
 * skipped at extraction, never added to the desired FactBase). This is a
 * chosen contract, not an oversight: the gate family above protects PHYSICAL
 * safety (destruction / guaranteed apply-failure) — this is a DESIRED-STATE
 * FIDELITY gap instead (the delta is the server's; the manageability
 * question is the mapping's), owned by the diagnostic + the #340 reporting
 * channel, not by this gate. This test pins that plan() does NOT throw here.
 */
describe("plan() — desired-side unreadable mapping with no source-side container (fidelity, not safety — #340)", () => {
  test("plan() does not throw; it creates the server but omits the un-creatable mapping", () => {
    const source = buildFactBase([], []);
    const desired = buildFactBase([serverFact], []);
    desired.diagnostics.push({
      code: USER_MAPPING_UNREADABLE,
      severity: "warning",
      subject: mappingId, // { server: "srv", role: "PUBLIC" }
      message: "hidden on desired",
    });

    let thePlan: ReturnType<typeof plan> | undefined;
    expect(() => {
      thePlan = plan(source, desired);
    }).not.toThrow();

    const sql = thePlan!.actions.map((a) => a.sql);
    expect(sql.some((s) => s.includes("CREATE SERVER"))).toBe(true);
    expect(sql.some((s) => s.includes("CREATE USER MAPPING"))).toBe(false);
  });
});
