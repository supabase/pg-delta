/**
 * Unit tests for the policy-projection seam in action EMISSION (review P1 #1).
 * No Docker / database required.
 *
 * Create rules inline child facts via `alsoProduces` (a column's DEFAULT, a
 * partitioned table's columns, a composite type's attributes, a publication's
 * relations). Emission must render against the PROJECTED plan target, not the
 * full `desired` view — otherwise a child whose own `add` delta was filtered out
 * by the policy is still rendered into the SQL and claimed as produced, which a
 * non-proof apply path turns into managed drift.
 *
 * The companion invariant in buildActionGraph still consults the un-projected
 * `desired` graph for missing-requirement detection (see internal.ts); this test
 * pins ONLY the emission half of the seam.
 */
import { describe, expect, test } from "bun:test";
import { buildFactBase, type Fact } from "../core/fact.ts";
import type { Payload } from "../core/hash.ts";
import { encodeId, type StableId } from "../core/stable-id.ts";
import { plan } from "./plan.ts";
import type { Policy } from "../policy/policy.ts";

const schemaApp: StableId = { kind: "schema", name: "app" };
const tableT: StableId = { kind: "table", schema: "app", name: "t" };
const colX: StableId = {
  kind: "column",
  schema: "app",
  table: "t",
  name: "x",
};
const defX: StableId = {
  kind: "default",
  schema: "app",
  table: "t",
  name: "x",
};

function makeFact(
  id: StableId,
  payload: Payload = {},
  parent?: StableId,
): Fact {
  return parent ? { id, parent, payload } : { id, payload };
}

describe("create-rule inlining respects the projected plan target (review P1 #1)", () => {
  test("a filtered-out DEFAULT child is not inlined into ADD COLUMN", () => {
    // source already has schema app + table app.t
    const source = buildFactBase(
      [makeFact(schemaApp), makeFact(tableT, {}, schemaApp)],
      [],
    );
    // desired adds column app.t.x WITH a DEFAULT 42 child
    const desired = buildFactBase(
      [
        makeFact(schemaApp),
        makeFact(tableT, {}, schemaApp),
        makeFact(colX, { type: "integer" }, tableT),
        makeFact(defX, { expr: "42" }, colX),
      ],
      [],
    );
    // policy keeps `add:column` but filters out `add:default`
    const policy: Policy = {
      id: "no-default-adds",
      filter: [
        {
          match: { all: [{ kind: "default" }, { verb: "add" }] },
          action: "exclude",
        },
      ],
    };

    const p = plan(source, desired, { policy });

    // exactly one action: the column add, rendered WITHOUT the filtered default
    expect(p.actions).toHaveLength(1);
    const action = p.actions[0]!;
    expect(action.sql).toBe(`ALTER TABLE "app"."t" ADD COLUMN "x" integer`);
    expect(action.sql).not.toContain("DEFAULT");
    // and the action must not claim to produce the filtered-out default fact
    expect(action.produces.map((id) => encodeId(id))).not.toContain(
      encodeId(defX),
    );

    // the filtered default add is still reported — drift the user chose not to
    // manage is never silently absent (§3.9)
    expect(
      p.filteredDeltas.some(
        (d) => d.verb === "add" && encodeId(d.fact.id) === encodeId(defX),
      ),
    ).toBe(true);

    // the plan target excludes the default, so source != target (a real plan)
    expect(p.target.fingerprint).not.toBe(p.source.fingerprint);
  });

  test("an unfiltered DEFAULT child is still inlined (no policy regression)", () => {
    const source = buildFactBase(
      [makeFact(schemaApp), makeFact(tableT, {}, schemaApp)],
      [],
    );
    const desired = buildFactBase(
      [
        makeFact(schemaApp),
        makeFact(tableT, {}, schemaApp),
        makeFact(colX, { type: "integer" }, tableT),
        makeFact(defX, { expr: "42" }, colX),
      ],
      [],
    );

    const p = plan(source, desired);

    const action = p.actions[0]!;
    expect(action.sql).toBe(
      `ALTER TABLE "app"."t" ADD COLUMN "x" integer DEFAULT 42`,
    );
    expect(action.produces.map((id) => encodeId(id))).toContain(encodeId(defX));
  });
});

describe("default-privilege hygiene respects the projected plan target (review P1 #3)", () => {
  test("a filtered grantee role + default ACL emit no REVOKE mentioning it", () => {
    const rolePayload = (): Payload => ({
      superuser: false,
      inherit: true,
      createRole: false,
      createDb: false,
      login: false,
      replication: false,
      bypassRls: false,
      config: [],
    });
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
    const roleOwner: StableId = { kind: "role", name: "owner" };
    const roleG: StableId = { kind: "role", name: "g" };
    const dp: StableId = {
      kind: "defaultPrivilege",
      role: "owner",
      schema: "app",
      objtype: "r",
      grantee: "g",
    };

    // source: just role owner + schema app
    const source = buildFactBase(
      [makeFact(roleOwner, rolePayload()), makeFact(schemaApp)],
      [],
    );
    // desired adds role g, table app.t (owned by owner), and a default ACL
    // granting SELECT from owner to g
    const desired = buildFactBase(
      [
        makeFact(roleOwner, rolePayload()),
        makeFact(roleG, rolePayload()),
        makeFact(schemaApp),
        makeFact(tableT, tablePayload(), schemaApp),
        makeFact(dp, { privileges: ["SELECT"], grantable: [] }),
      ],
      [{ from: tableT, to: roleOwner, kind: "owner" }],
    );

    // policy filters BOTH the grantee role add and the default-privilege add
    const policy: Policy = {
      id: "drop-role-and-defacl",
      filter: [
        {
          match: { all: [{ kind: "role" }, { name: "g" }, { verb: "add" }] },
          action: "exclude",
        },
        {
          match: { all: [{ kind: "defaultPrivilege" }, { verb: "add" }] },
          action: "exclude",
        },
      ],
    };

    // hygiene must read the PROJECTED target (where g and the default ACL are
    // gone), not the unprojected `desired` — else it emits an impossible REVOKE
    let p!: ReturnType<typeof plan>;
    expect(() => {
      p = plan(source, desired, { policy, compact: false });
    }).not.toThrow();

    // no emitted statement may mention the filtered-away grantee role
    for (const action of p.actions) {
      expect(action.sql).not.toContain('"g"');
    }
  });
});
