/**
 * End-to-end: a live PostGIS install whose desired state names a different
 * schema must refuse at plan() — not emit DROP EXTENSION postgis.
 *
 * Gated on the Supabase image (stock alpine has no postgis).
 */
import { afterAll, describe, expect, test } from "bun:test";
import { extract } from "../src/extract/extract.ts";
import { plan } from "../src/plan/plan.ts";
import {
  runSupabaseBareTests,
  supabaseCluster,
  type TestDb,
} from "./containers.ts";

const dbs: TestDb[] = [];
afterAll(async () => {
  await Promise.all(dbs.map((d) => d.drop().catch(() => {})));
});

async function dropPostgisFamily(pool: TestDb["pool"]): Promise<void> {
  // Image templates may already carry postgis* extensions; tear them down so
  // each side can install postgis into a chosen schema.
  await pool.query(`
    DO $$
    DECLARE ext text;
    BEGIN
      FOREACH ext IN ARRAY ARRAY[
        'postgis_tiger_geocoder',
        'postgis_topology',
        'postgis_raster',
        'address_standardizer',
        'address_standardizer_data_us',
        'postgis'
      ]
      LOOP
        EXECUTE format('DROP EXTENSION IF EXISTS %I CASCADE', ext);
      END LOOP;
    END $$;
  `);
}

describe.skipIf(!runSupabaseBareTests)(
  "postgis non-relocation guard (e2e)",
  () => {
    test("live postgis schema disagreement refuses to plan a rebuild", async () => {
      const cluster = await supabaseCluster();
      const src = await cluster.createDb("postgis_reloc_src");
      const dst = await cluster.createDb("postgis_reloc_dst");
      dbs.push(src, dst);

      await dropPostgisFamily(src.pool);
      await dropPostgisFamily(dst.pool);
      await src.pool.query(`CREATE EXTENSION postgis SCHEMA public`);
      await dst.pool.query(`CREATE SCHEMA IF NOT EXISTS geo`);
      await dst.pool.query(`CREATE EXTENSION postgis SCHEMA geo`);

      const srcFb = (await extract(src.pool)).factBase;
      const dstFb = (await extract(dst.pool)).factBase;
      expect(() => plan(srcFb, dstFb)).toThrow(
        /extension "postgis" cannot be relocated from schema "public" to "geo"/,
      );
      expect(() => plan(srcFb, dstFb)).toThrow(
        /PostGIS cannot be relocated after install/,
      );
    }, 180_000);
  },
);
