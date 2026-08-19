/**
 * supabase_vault presence-only contract (CLI-1434, docs/architecture/vault.md).
 *
 * Gated on the Supabase image (stock alpine has no supabase_vault) except the
 * shadow-precheck test, which asserts the alpine INCAPABLE path.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VAULT_PRESENCE } from "../src/core/diagnostic.ts";
import { extract } from "../src/extract/extract.ts";
import { cmdSchemaApply } from "../src/cli/commands/schema.ts";
import { hasBlockingDiagnostics } from "../src/frontends/diagnostics.ts";
import { classifyPlanHazards } from "../src/plan/hazards.ts";
import { plan } from "../src/plan/plan.ts";
import {
  runSupabaseBareTests,
  sharedCluster,
  supabaseCluster,
  type TestDb,
} from "./containers.ts";

const dbs: TestDb[] = [];
afterAll(async () => {
  await Promise.all(dbs.map((d) => d.drop().catch(() => {})));
});

async function ensureVault(pool: TestDb["pool"], installed: boolean) {
  if (installed) {
    await pool.query(`CREATE EXTENSION IF NOT EXISTS supabase_vault`);
  } else {
    await pool.query(`DROP EXTENSION IF EXISTS supabase_vault CASCADE`);
  }
}

describe.skipIf(!runSupabaseBareTests)(
  "vault presence (supabase image)",
  () => {
    test("case 2: raw-profile source-with-vault vs plain target plans CREATE EXTENSION", async () => {
      const cluster = await supabaseCluster();
      const source = await cluster.createDb("vault_c2_src");
      const desired = await cluster.createDb("vault_c2_dst");
      dbs.push(source, desired);
      await ensureVault(source.pool, false);
      await ensureVault(desired.pool, true);

      const thePlan = plan(
        (await extract(source.pool)).factBase,
        (await extract(desired.pool)).factBase,
      );
      expect(
        thePlan.actions.some((a) =>
          /CREATE EXTENSION "supabase_vault"/.test(a.sql),
        ),
      ).toBe(true);
      expect(
        (thePlan.diagnostics ?? []).some((d) => d.code === VAULT_PRESENCE),
      ).toBe(false);
    }, 180_000);

    test("case 3: a user view over vault.decrypted_secrets emits vault_presence", async () => {
      const cluster = await supabaseCluster();
      const source = await cluster.createDb("vault_c3_src");
      const desired = await cluster.createDb("vault_c3_dst");
      dbs.push(source, desired);
      await ensureVault(source.pool, false);
      await ensureVault(desired.pool, true);
      // A user VIEW, not a LANGUAGE sql function: on this image
      // `check_function_bodies` is off, so `CREATE FUNCTION … SELECT FROM
      // vault.decrypted_secrets` records no pg_depend and would silently
      // degrade to case 2. A view always carries the catalog edge.
      await desired.pool.query(`
      CREATE VIEW public.secrets_list AS
      SELECT * FROM vault.decrypted_secrets;
    `);

      const thePlan = plan(
        (await extract(source.pool)).factBase,
        (await extract(desired.pool)).factBase,
      );
      expect(
        thePlan.actions.some((a) =>
          /CREATE EXTENSION "supabase_vault"/.test(a.sql),
        ),
      ).toBe(true);
      const diags = thePlan.diagnostics ?? [];
      expect(diags.some((d) => d.code === VAULT_PRESENCE)).toBe(true);
      expect(hasBlockingDiagnostics(diags)).toBe(false);
      expect(hasBlockingDiagnostics(diags, { strictCoverage: true })).toBe(
        true,
      );
    }, 180_000);

    test("case 4: DROP EXTENSION supabase_vault is destructive (vault.secrets)", async () => {
      const cluster = await supabaseCluster();
      const source = await cluster.createDb("vault_c4_src");
      const desired = await cluster.createDb("vault_c4_dst");
      dbs.push(source, desired);
      await ensureVault(source.pool, true);
      await source.pool.query(`SELECT vault.create_secret('s', 'name')`);
      await ensureVault(desired.pool, false);

      const thePlan = plan(
        (await extract(source.pool)).factBase,
        (await extract(desired.pool)).factBase,
      );
      const drop = thePlan.actions.find((a) =>
        /DROP EXTENSION "supabase_vault"/.test(a.sql),
      );
      expect(drop).toBeDefined();
      expect(drop!.dataLoss).toBe("destructive");
      expect(classifyPlanHazards(thePlan).kinds).toContain("data_loss");
      expect(
        (thePlan.diagnostics ?? []).some(
          (d) => d.code === VAULT_PRESENCE && /vault\.secrets/.test(d.message),
        ),
      ).toBe(true);
    }, 180_000);
  },
);

describe("vault shadow precheck (alpine)", () => {
  test("vault.create_secret against a stock-alpine shadow fails early", async () => {
    const cluster = await sharedCluster();
    const target = await cluster.createDb("vaultguard_tgt");
    const work = mkdtempSync(join(tmpdir(), "pgdelta-vaultguard-"));
    try {
      const dir = join(work, "schema");
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "01_vault.sql"),
        `select vault.create_secret('x','y');\n`,
      );

      let err: unknown;
      try {
        await cmdSchemaApply([
          "--dir",
          dir,
          "--target",
          target.uri,
          "--renames",
          "off",
        ]);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatch(/supabase_vault statements/);
      expect((err as Error).message).toMatch(/does not ship supabase_vault/);
    } finally {
      await target.drop();
    }
  }, 90_000);
});
