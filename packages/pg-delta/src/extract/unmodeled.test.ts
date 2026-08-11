/**
 * The unmodeled-kind IDENTITY probe and the `unmodeled_drift` comparison
 * (docs/architecture/custom-folder.md §7, Phase 2).
 *
 * `detectUnmodeledKinds` answers "does this database contain user objects of a
 * kind we do not model?" with a count and five samples — enough for a warning,
 * not enough to COMPARE two databases. Planning needs the comparison: raw
 * `_custom/` SQL runs only in the shadow, so a shadow that has a cast the target
 * lacks means every planned statement depending on that cast will fail on the
 * target. These tests pin the identity probe (full name lists, provenance
 * filters intact) and the set-diff that turns it into the pre-flight warning.
 *
 * Pure unit tests: the probe runs against a fake queryable, so no database.
 */
import { describe, expect, test } from "bun:test";
import {
  detectUnmodeledDrift,
  probeUnmodeledIdentities,
  type UnmodeledIdentities,
} from "./unmodeled.ts";

interface IdentityRow {
  kind: string;
  names: string[] | null;
}

/** A `query`-only stand-in for a `Pool`/`PoolClient` that replays canned rows
 *  and records the SQL it was handed. */
function fakeQueryable(rows: IdentityRow[]): {
  query: <R>(sql: string) => Promise<{ rows: R[] }>;
  sql: string[];
} {
  const sql: string[] = [];
  return {
    sql,
    query: async <R>(text: string): Promise<{ rows: R[] }> => {
      sql.push(text);
      return { rows: rows as unknown as R[] };
    },
  };
}

const identities = (entries: Record<string, string[]>): UnmodeledIdentities =>
  new Map(Object.entries(entries));

describe("probeUnmodeledIdentities", () => {
  test("returns the FULL identity list per kind, dropping empty kinds", async () => {
    const q = fakeQueryable([
      { kind: "cast", names: ["text AS public.ltree", "public.ltree AS text"] },
      { kind: "operator", names: null },
      { kind: "text search configuration", names: ["my_cfg"] },
    ]);
    const result = await probeUnmodeledIdentities(q, 17);
    expect([...result.keys()]).toEqual(["cast", "text search configuration"]);
    expect(result.get("cast")).toEqual([
      "text AS public.ltree",
      "public.ltree AS text",
    ]);
    // NOT capped at 5 like the count+samples diagnostic query
    expect(q.sql[0]).toContain("array_agg(nm ORDER BY nm) AS names");
    expect(q.sql[0]).not.toContain("[1:5]");
  });

  test("keeps the provenance filters (built-ins, extension members, internal dependents)", async () => {
    const q = fakeQueryable([]);
    await probeUnmodeledIdentities(q, 17);
    const sql = q.sql[0] ?? "";
    expect(sql).toContain("16384");
    expect(sql).toContain("deptype = 'e'");
    expect(sql).toContain("deptype = 'i'");
  });

  test("drops version-gated probes below their minimum major", async () => {
    const q14 = fakeQueryable([]);
    await probeUnmodeledIdentities(q14, 14);
    expect(q14.sql[0]).not.toContain("pg_parameter_acl");
    const q15 = fakeQueryable([]);
    await probeUnmodeledIdentities(q15, 15);
    expect(q15.sql[0]).toContain("pg_parameter_acl");
  });
});

describe("detectUnmodeledDrift", () => {
  test("warns per kind the shadow has and the target lacks", () => {
    const drift = detectUnmodeledDrift(
      identities({
        "text search configuration": ["my_cfg"],
        cast: ["text AS public.ltree"],
      }),
      identities({ cast: ["text AS public.ltree"] }),
    );
    expect(drift).toHaveLength(1);
    const [d] = drift;
    expect(d?.code).toBe("unmodeled_drift");
    expect(d?.severity).toBe("warning");
    expect(d?.message).toContain("my_cfg");
    expect(d?.message).toContain("text search configuration");
    expect(d?.context).toEqual({
      kind: "text search configuration",
      count: 1,
      missing: ["my_cfg"],
    });
  });

  test("is silent when the target has everything the shadow has", () => {
    const same = { cast: ["text AS public.ltree"], operator: ["###"] };
    expect(detectUnmodeledDrift(identities(same), identities(same))).toEqual(
      [],
    );
  });

  test("ignores the reverse direction — target EXTRAS are not drift", () => {
    expect(
      detectUnmodeledDrift(
        identities({}),
        identities({ cast: ["text AS public.ltree"], operator: ["###"] }),
      ),
    ).toEqual([]);
  });

  test("diffs per identity, not per kind count", () => {
    const drift = detectUnmodeledDrift(
      identities({ operator: ["###", "@@@", "%%%"] }),
      identities({ operator: ["@@@"] }),
    );
    expect(drift).toHaveLength(1);
    expect(drift[0]?.context?.["missing"]).toEqual(["###", "%%%"]);
  });

  test("caps the listed identities at 10 but reports the true total", () => {
    const many = Array.from({ length: 14 }, (_, i) => `op${i}`);
    const drift = detectUnmodeledDrift(
      identities({ operator: many }),
      identities({}),
    );
    expect(drift[0]?.context?.["count"]).toBe(14);
    expect(drift[0]?.message).toContain("op9");
    expect(drift[0]?.message).not.toContain("op10");
    expect(drift[0]?.message).toContain("14");
  });

  test("names the delivery channel — the plan cannot create these objects", () => {
    const [d] = detectUnmodeledDrift(
      identities({ cast: ["text AS public.ltree"] }),
      identities({}),
    );
    expect(d?.message).toMatch(/migration channel/i);
    expect(d?.message).toContain("_custom/");
  });

  test("emits one diagnostic per drifting kind, ordered by kind", () => {
    const drift = detectUnmodeledDrift(
      identities({ operator: ["###"], cast: ["text AS int"] }),
      identities({}),
    );
    expect(drift.map((d) => d.context?.["kind"])).toEqual(["cast", "operator"]);
  });
});
