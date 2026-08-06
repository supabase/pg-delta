/**
 * Unit tests for compaction's multi-grantee GRANT merge (§3.6). No Docker /
 * database required — synthetic fact bases drive `plan()` end to end, so the
 * whole pass chain (co-create REVOKE elision → grant merge) is exercised.
 *
 * A freshly created object granted the SAME privilege set to several roles
 * emits one GRANT per grantee (pg_dump's model). After the co-create REVOKE
 * leaders are elided those GRANTs are consecutive in the final order and
 * differ only in grantee — idiomatic hand-written SQL grants them in one
 * statement (`GRANT … TO a, b, c`), so the cosmetic pass merges them.
 */
import { describe, expect, test } from "bun:test";
import { buildFactBase, type Fact } from "../core/fact.ts";
import type { Payload } from "../core/hash.ts";
import type { StableId } from "../core/stable-id.ts";
import { plan } from "./plan.ts";

const schemaApp: StableId = { kind: "schema", name: "app" };
const tableT: StableId = { kind: "table", schema: "app", name: "t" };
const role = (name: string): StableId => ({ kind: "role", name });
const acl = (grantee: string, target: StableId = tableT): StableId => ({
  kind: "acl",
  target,
  grantee,
});

const f = (id: StableId, payload: Payload = {}, parent?: StableId): Fact =>
  parent ? { id, parent, payload } : { id, payload };
const tablePayload = (): Payload => ({
  persistence: "p",
  rowSecurity: false,
  forceRowSecurity: false,
  replicaIdentity: "d",
  replicaIdentityIndex: null,
  partitionKey: null,
  partitionBound: null,
  parentTable: null,
});
const aclFact = (
  grantee: string,
  privileges: string[],
  grantable: string[] = [],
  target: StableId = tableT,
): Fact => f(acl(grantee, target), { privileges, grantable }, target);

const ROLES = ["anon", "authenticated", "service_role"];
const roleFacts = ROLES.map((name) => f(role(name)));

/** Source carries only the (unmanaged-change-free) roles, so the plan creates
 *  the schema + table + grants from scratch — the co-create shape. */
const source = buildFactBase(roleFacts, []);

const grants = (p: ReturnType<typeof plan>) =>
  p.actions.filter((a) => a.sql.startsWith("GRANT "));

describe("compaction merges co-created same-privilege grants", () => {
  test("one GRANT with a grantee list replaces the per-role statements", () => {
    const desired = buildFactBase(
      [
        ...roleFacts,
        f(schemaApp),
        f(tableT, tablePayload(), schemaApp),
        ...ROLES.map((r) => aclFact(r, ["DELETE", "INSERT", "SELECT"])),
      ],
      [],
    );
    const compacted = plan(source, desired);
    expect(grants(compacted).map((a) => a.sql)).toEqual([
      `GRANT DELETE, INSERT, SELECT ON TABLE "app"."t" TO "anon", "authenticated", "service_role"`,
    ]);
    // the merged action carries every grantee role in consumes, and no
    // dangling acl ids (nothing in the compacted plan produces them)
    const merged = grants(compacted)[0]!;
    for (const r of ROLES) {
      expect(merged.consumes.some((c) => c.kind === "role" && "name" in c && c.name === r)).toBe(
        true,
      );
    }
    expect(merged.consumes.some((c) => c.kind === "acl")).toBe(false);
  });

  test("uncompacted plan keeps one GRANT per grantee", () => {
    const desired = buildFactBase(
      [
        ...roleFacts,
        f(schemaApp),
        f(tableT, tablePayload(), schemaApp),
        ...ROLES.map((r) => aclFact(r, ["SELECT"])),
      ],
      [],
    );
    const decomposed = plan(source, desired, { compact: false });
    expect(grants(decomposed)).toHaveLength(3);
  });

  test("a differing privilege set splits the run", () => {
    const desired = buildFactBase(
      [
        ...roleFacts,
        f(schemaApp),
        f(tableT, tablePayload(), schemaApp),
        aclFact("anon", ["SELECT"]),
        aclFact("authenticated", ["INSERT", "SELECT"]),
        aclFact("service_role", ["SELECT"]),
      ],
      [],
    );
    const compacted = plan(source, desired);
    // grantee order (anon, authenticated, service_role) is the deterministic
    // tie-break order; the odd set in the middle breaks adjacency, so the two
    // SELECT-only grants do NOT merge across it
    expect(grants(compacted).map((a) => a.sql)).toEqual([
      `GRANT SELECT ON TABLE "app"."t" TO "anon"`,
      `GRANT INSERT, SELECT ON TABLE "app"."t" TO "authenticated"`,
      `GRANT SELECT ON TABLE "app"."t" TO "service_role"`,
    ]);
  });

  test("PUBLIC merges like any grantee", () => {
    const desired = buildFactBase(
      [
        ...roleFacts,
        f(schemaApp),
        f(tableT, tablePayload(), schemaApp),
        aclFact("PUBLIC", ["SELECT"]),
        aclFact("anon", ["SELECT"]),
      ],
      [],
    );
    const compacted = plan(source, desired);
    expect(grants(compacted).map((a) => a.sql)).toEqual([
      `GRANT SELECT ON TABLE "app"."t" TO PUBLIC, "anon"`,
    ]);
  });

  test("grant-option groups never merge", () => {
    const desired = buildFactBase(
      [
        ...roleFacts,
        f(schemaApp),
        f(tableT, tablePayload(), schemaApp),
        aclFact("anon", ["SELECT"], ["SELECT"]),
        aclFact("authenticated", ["SELECT"], ["SELECT"]),
      ],
      [],
    );
    const compacted = plan(source, desired);
    for (const a of grants(compacted)) {
      expect(a.sql).not.toContain(`"anon", "authenticated"`);
    }
  });

  test("grants on different targets never merge", () => {
    const tableU: StableId = { kind: "table", schema: "app", name: "u" };
    const desired = buildFactBase(
      [
        ...roleFacts,
        f(schemaApp),
        f(tableT, tablePayload(), schemaApp),
        f(tableU, tablePayload(), schemaApp),
        aclFact("anon", ["SELECT"], [], tableT),
        aclFact("anon", ["SELECT"], [], tableU),
      ],
      [],
    );
    const compacted = plan(source, desired);
    expect(grants(compacted).map((a) => a.sql).sort()).toEqual([
      `GRANT SELECT ON TABLE "app"."t" TO "anon"`,
      `GRANT SELECT ON TABLE "app"."u" TO "anon"`,
    ]);
  });

  test("grants on a PRE-EXISTING object keep their REVOKE leaders and stay per-grantee", () => {
    // the target table already exists on the source, so the leading
    // REVOKE ALL per grantee is load-bearing and interleaves the GRANTs —
    // no consecutive run forms, nothing merges.
    const preSource = buildFactBase(
      [...roleFacts, f(schemaApp), f(tableT, tablePayload(), schemaApp)],
      [],
    );
    const desired = buildFactBase(
      [
        ...roleFacts,
        f(schemaApp),
        f(tableT, tablePayload(), schemaApp),
        aclFact("anon", ["SELECT"]),
        aclFact("authenticated", ["SELECT"]),
      ],
      [],
    );
    const compacted = plan(preSource, desired);
    expect(grants(compacted).map((a) => a.sql)).toEqual([
      `GRANT SELECT ON TABLE "app"."t" TO "anon"`,
      `GRANT SELECT ON TABLE "app"."t" TO "authenticated"`,
    ]);
    const revokes = compacted.actions.filter((a) => a.sql.startsWith("REVOKE"));
    expect(revokes).toHaveLength(2);
  });
});
