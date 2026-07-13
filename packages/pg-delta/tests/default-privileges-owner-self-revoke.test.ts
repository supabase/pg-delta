/**
 * Regression: a GLOBAL (no IN SCHEMA) default-privileges row whose owner
 * self-entry was revoked while OTHER grantees remain must be extracted as a
 * real `revoked_default` marker.
 *
 * `pg_default_acl` stores the RESULTING default ACL, and for a GLOBAL row a
 * grant to another role MATERIALIZES the owner's own acldefault self-entry
 * (verified on postgres:17):
 *
 *   ALTER DEFAULT PRIVILEGES FOR ROLE alice GRANT SELECT ON TABLES TO bob;
 *   -- global row: {alice=arwdDxtm/alice, bob=r/alice}   (alice PRESENT)
 *
 * Explicitly revoking the owner then drops that self-entry:
 *
 *   ALTER DEFAULT PRIVILEGES FOR ROLE alice REVOKE ALL ON TABLES FROM alice;
 *   -- global row now: {bob=r/alice}                     (alice ABSENT)
 *
 * and Postgres uses that stored ACL VERBATIM at object creation, so a table
 * later created by alice really lacks alice's own privileges. The owner-revoke
 * is therefore a genuine customization that must survive export/apply/reverse.
 *
 * This blind spot is invisible to the corpus proof loop: extraction is symmetric
 * (source, desired and re-extracted clone all run through the same `extract`), so
 * an extraction that cannot SEE the owner-revoke declares false convergence. This
 * test asserts on the fact base directly, which is where the bug lives.
 *
 * The suppression IS correct in two other shapes, which this test pins:
 *   - PER-SCHEMA rows: Postgres always re-merges the owner's acldefault at object
 *     creation, so owner-absence there is a behavioral no-op → no marker.
 *   - A BARE GLOBAL self-revoke with nothing else granted: the stored row is
 *     EMPTY (`{}`), the created table's relacl is NULL and the owner keeps its
 *     privileges → still a no-op → no marker.
 *
 * Docker required.
 */
import { describe, expect, test } from "bun:test";
import { extract } from "../src/extract/extract.ts";
import { createTestDb } from "./containers.ts";

/** The revoked-owner-default marker for `owner`'s own self-entry, if extracted:
 *  a `defaultPrivilege` fact whose role and grantee are both `owner`, carrying
 *  `_revokedDefault` (the built-in privileges the revoke removed). */
function ownerRevokedMarker(
  facts: readonly { id: unknown; payload: Record<string, unknown> }[],
  owner: string,
  schema: string | null,
): (typeof facts)[number] | undefined {
  return facts.find((f) => {
    const id = f.id as {
      kind: string;
      role?: string;
      schema?: string | null;
      grantee?: string;
    };
    return (
      id.kind === "defaultPrivilege" &&
      id.role === owner &&
      id.grantee === owner &&
      (id.schema ?? null) === schema &&
      f.payload["_revokedDefault"] != null
    );
  });
}

describe("default privileges — owner self-revoke extraction", () => {
  test("GLOBAL owner self-revoke alongside a grant-to-other is extracted as a marker", async () => {
    const db = await createTestDb("dpsr_global");
    try {
      await db.pool.query("CREATE ROLE dpsr_g_owner NOLOGIN");
      await db.pool.query("CREATE ROLE dpsr_g_reader NOLOGIN");
      await db.pool.query(
        "ALTER DEFAULT PRIVILEGES FOR ROLE dpsr_g_owner REVOKE ALL ON TABLES FROM dpsr_g_owner",
      );
      await db.pool.query(
        "ALTER DEFAULT PRIVILEGES FOR ROLE dpsr_g_owner GRANT SELECT ON TABLES TO dpsr_g_reader",
      );

      const { factBase } = await extract(db.pool);
      const facts = factBase.facts() as unknown as {
        id: unknown;
        payload: Record<string, unknown>;
      }[];
      const marker = ownerRevokedMarker(facts, "dpsr_g_owner", null);

      // RED before fix: the blanket owner exclusion drops this marker, so the
      // real global owner-revoke vanishes from the fact base.
      expect(marker).toBeDefined();
      // The exact acldefault privilege set is version-dependent (PG17 adds
      // MAINTAIN), so assert the revoked table defaults contain the stable
      // core privileges rather than pinning the whole list.
      const revoked = marker?.payload["_revokedDefault"] as
        | string[]
        | undefined;
      expect(revoked).toEqual(
        expect.arrayContaining([
          "DELETE",
          "INSERT",
          "REFERENCES",
          "SELECT",
          "TRIGGER",
          "TRUNCATE",
          "UPDATE",
        ]),
      );
    } finally {
      await db.drop();
      await db.cluster.adminPool
        .query("DROP ROLE IF EXISTS dpsr_g_owner")
        .catch(() => {});
      await db.cluster.adminPool
        .query("DROP ROLE IF EXISTS dpsr_g_reader")
        .catch(() => {});
    }
  }, 60_000);

  test("PER-SCHEMA owner self-revoke is a no-op (owner re-merged at creation) — no marker", async () => {
    const db = await createTestDb("dpsr_schema");
    try {
      await db.pool.query("CREATE ROLE dpsr_s_owner NOLOGIN");
      await db.pool.query("CREATE ROLE dpsr_s_reader NOLOGIN");
      await db.pool.query("CREATE SCHEMA dpsr_s AUTHORIZATION dpsr_s_owner");
      await db.pool.query(
        "ALTER DEFAULT PRIVILEGES FOR ROLE dpsr_s_owner IN SCHEMA dpsr_s REVOKE ALL ON TABLES FROM dpsr_s_owner",
      );
      await db.pool.query(
        "ALTER DEFAULT PRIVILEGES FOR ROLE dpsr_s_owner IN SCHEMA dpsr_s GRANT SELECT ON TABLES TO dpsr_s_reader",
      );

      const { factBase } = await extract(db.pool);
      const facts = factBase.facts() as unknown as {
        id: unknown;
        payload: Record<string, unknown>;
      }[];

      expect(
        ownerRevokedMarker(facts, "dpsr_s_owner", "dpsr_s"),
      ).toBeUndefined();
    } finally {
      await db.drop();
      await db.cluster.adminPool
        .query("DROP ROLE IF EXISTS dpsr_s_owner")
        .catch(() => {});
      await db.cluster.adminPool
        .query("DROP ROLE IF EXISTS dpsr_s_reader")
        .catch(() => {});
    }
  }, 60_000);

  test("BARE GLOBAL owner self-revoke (empty row) is a no-op — no marker", async () => {
    const db = await createTestDb("dpsr_bare");
    try {
      await db.pool.query("CREATE ROLE dpsr_b_owner NOLOGIN");
      await db.pool.query(
        "ALTER DEFAULT PRIVILEGES FOR ROLE dpsr_b_owner REVOKE ALL ON TABLES FROM dpsr_b_owner",
      );

      const { factBase } = await extract(db.pool);
      const facts = factBase.facts() as unknown as {
        id: unknown;
        payload: Record<string, unknown>;
      }[];

      expect(ownerRevokedMarker(facts, "dpsr_b_owner", null)).toBeUndefined();
    } finally {
      await db.drop();
      await db.cluster.adminPool
        .query("DROP ROLE IF EXISTS dpsr_b_owner")
        .catch(() => {});
    }
  }, 60_000);
});
