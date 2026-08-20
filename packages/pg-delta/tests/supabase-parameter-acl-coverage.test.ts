/**
 * Platform `pg_parameter_acl` grants (PG 15+) are cluster-wide and show up on
 * every supabase-shaped extract as `unmodeled_kind`. The supabase profile must
 * drop the exact bootstrap triples and keep any other parameter ACL as a
 * coverage gap. Raw extract is unchanged.
 *
 * Grants are revoked in `finally` so they cannot leak into another file's
 * extract on the shared test cluster.
 */
import { describe, expect, test } from "bun:test";
import type { Pool } from "pg";
import type { Diagnostic } from "../src/core/diagnostic.ts";
import { extract } from "../src/extract/extract.ts";
import { rawProfile, resolveProfile } from "../src/integrations/profile.ts";
import { supabaseProfile } from "../src/integrations/supabase.ts";
import { supabasePolicy } from "../src/policy/supabase.ts";
import { classifyPlanHazards } from "../src/plan/hazards.ts";
import { createTestDb } from "./containers.ts";

const PG_MAJOR = Number(
  /postgres:(\d+)/.exec(
    process.env["PGDELTA_TEST_IMAGE"] ?? "postgres:17-alpine",
  )?.[1] ?? "17",
);

const PLATFORM_ROLES = ["supabase_admin", "supabase_realtime_admin"] as const;

function parameterAcl(diagnostics: readonly Diagnostic[]) {
  return diagnostics.find(
    (d) =>
      d.code === "unmodeled_kind" && d.context?.["kind"] === "parameter ACL",
  );
}

async function ensureRole(pool: Pool, name: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM pg_roles WHERE rolname = $1`,
    [name],
  );
  if (rows.length > 0) return false;
  await pool.query(`CREATE ROLE "${name}"`);
  return true;
}

async function grantPlatformParameterAcls(pool: Pool): Promise<void> {
  await pool.query(
    `GRANT SET, ALTER SYSTEM ON PARAMETER log_min_messages TO supabase_admin`,
  );
  await pool.query(
    `GRANT SET ON PARAMETER log_min_messages TO supabase_realtime_admin`,
  );
  // GRANT as the test superuser also records that role on paracl. A real
  // platform catalog is owned by supabase_admin, whose triples are already
  // allowlisted — strip the fixture grantor so the row matches production.
  await pool.query(
    `REVOKE SET, ALTER SYSTEM ON PARAMETER log_min_messages FROM CURRENT_USER`,
  );
}

async function revokePlatformParameterAcls(pool: Pool): Promise<void> {
  await pool.query(
    `REVOKE SET, ALTER SYSTEM ON PARAMETER log_min_messages FROM supabase_admin`,
  );
  await pool.query(
    `REVOKE SET ON PARAMETER log_min_messages FROM supabase_realtime_admin`,
  );
}

describe.skipIf(PG_MAJOR < 15)(
  "supabase profile: platform parameter ACL coverage",
  () => {
    test("raw extract names the platform ACL; supabase extract omits it", async () => {
      const db = await createTestDb("plat_acl");
      const created: string[] = [];
      try {
        for (const name of PLATFORM_ROLES) {
          if (await ensureRole(db.pool, name)) created.push(name);
        }
        await grantPlatformParameterAcls(db.pool);

        const raw = await extract(db.pool);
        const rawAcl = parameterAcl(raw.diagnostics);
        expect(rawAcl).toBeDefined();
        expect(rawAcl?.severity).toBe("warning");
        expect(rawAcl?.subject).toBeUndefined();
        expect(rawAcl?.context).toMatchObject({
          kind: "parameter ACL",
          count: 1,
        });
        expect(
          (rawAcl?.context?.["samples"] as string[] | undefined) ?? [],
        ).toContain("log_min_messages");
        expect(
          classifyPlanHazards({ actions: [] }, raw.diagnostics).coverage,
        ).toEqual(["unmodeled_kind"]);

        const supabase = await resolveProfile(db.pool, supabaseProfile, {
          skipBaseline: true,
        });
        const filtered = await supabase.extract(db.pool);
        expect(parameterAcl(filtered.diagnostics)).toBeUndefined();
        expect(
          classifyPlanHazards({ actions: [] }, filtered.diagnostics).coverage,
        ).toEqual([]);

        const rawProfileResolved = await resolveProfile(db.pool, rawProfile, {
          skipBaseline: true,
        });
        const viaRawProfile = await rawProfileResolved.extract(db.pool);
        expect(parameterAcl(viaRawProfile.diagnostics)).toBeDefined();

        const inherited = await resolveProfile(
          db.pool,
          {
            id: "custom",
            handlers: supabaseProfile.handlers,
            policy: { id: "custom", extends: [supabasePolicy] },
          },
          { skipBaseline: true },
        );
        const viaInherited = await inherited.extract(db.pool);
        expect(parameterAcl(viaInherited.diagnostics)).toBeUndefined();
      } finally {
        await revokePlatformParameterAcls(db.pool).catch(() => {});
        for (const name of created) {
          await db.pool.query(`DROP ROLE "${name}"`).catch(() => {});
        }
        await db.drop();
      }
    }, 120_000);

    test("a user parameter ACL remains a coverage gap under supabase", async () => {
      const db = await createTestDb("user_acl");
      const created: string[] = [];
      const userRole = `user_acl_${db.name}`;
      try {
        for (const name of PLATFORM_ROLES) {
          if (await ensureRole(db.pool, name)) created.push(name);
        }
        await db.pool.query(`CREATE ROLE ${userRole}`);
        await grantPlatformParameterAcls(db.pool);
        await db.pool.query(`GRANT SET ON PARAMETER work_mem TO ${userRole}`);

        const supabase = await resolveProfile(db.pool, supabaseProfile, {
          skipBaseline: true,
        });
        const result = await supabase.extract(db.pool);
        const acl = parameterAcl(result.diagnostics);
        expect(acl).toBeDefined();
        expect(
          ((acl?.context?.["samples"] ?? []) as string[]).join(" "),
        ).toContain("work_mem");
        expect(
          ((acl?.context?.["samples"] ?? []) as string[]).join(" "),
        ).not.toContain("log_min_messages");
        expect(acl?.context?.["count"]).toBe(1);
        expect(
          classifyPlanHazards({ actions: [] }, result.diagnostics).coverage,
        ).toEqual(["unmodeled_kind"]);
      } finally {
        await db.pool
          .query(`REVOKE SET ON PARAMETER work_mem FROM ${userRole}`)
          .catch(() => {});
        await db.pool
          .query(`REVOKE SET ON PARAMETER work_mem FROM CURRENT_USER`)
          .catch(() => {});
        await revokePlatformParameterAcls(db.pool).catch(() => {});
        await db.pool.query(`DROP ROLE ${userRole}`).catch(() => {});
        for (const name of created) {
          await db.pool.query(`DROP ROLE "${name}"`).catch(() => {});
        }
        await db.drop();
      }
    }, 120_000);

    test("a user grant on log_min_messages is still reported", async () => {
      const db = await createTestDb("user_lmm");
      const created: string[] = [];
      const userRole = `user_lmm_${db.name}`;
      try {
        for (const name of PLATFORM_ROLES) {
          if (await ensureRole(db.pool, name)) created.push(name);
        }
        await db.pool.query(`CREATE ROLE ${userRole}`);
        await grantPlatformParameterAcls(db.pool);
        await db.pool.query(
          `GRANT SET ON PARAMETER log_min_messages TO ${userRole}`,
        );

        const supabase = await resolveProfile(db.pool, supabaseProfile, {
          skipBaseline: true,
        });
        const result = await supabase.extract(db.pool);
        const acl = parameterAcl(result.diagnostics);
        expect(acl).toBeDefined();
        expect(
          ((acl?.context?.["samples"] ?? []) as string[]).join(" "),
        ).toContain("log_min_messages");
        expect(acl?.context?.["count"]).toBe(1);
      } finally {
        await db.pool
          .query(`REVOKE SET ON PARAMETER log_min_messages FROM ${userRole}`)
          .catch(() => {});
        await db.pool
          .query(
            `REVOKE SET, ALTER SYSTEM ON PARAMETER log_min_messages FROM CURRENT_USER`,
          )
          .catch(() => {});
        await revokePlatformParameterAcls(db.pool).catch(() => {});
        await db.pool.query(`DROP ROLE ${userRole}`).catch(() => {});
        for (const name of created) {
          await db.pool.query(`DROP ROLE "${name}"`).catch(() => {});
        }
        await db.drop();
      }
    }, 120_000);
  },
);
