/**
 * Replay helper for the Supabase baseline fixture.
 *
 * `tests/fixtures/supabase-base-init/<major>.sql` is the bare→full-stack delta
 * that `scripts/sync-supabase-base-images.ts` generates: applying it to a fresh
 * `supabase/postgres:<tag>` container reproduces the post-`supabase start` state
 * (auth/storage/realtime schemas, cluster-global roles, grants, …). Tests that
 * need a realistic Supabase TARGET boot the bare image (`supabaseCluster()`)
 * then call `applySupabaseBaseInit` to reach the full-stack schema cheaply,
 * without running the whole service stack per test.
 *
 * The fixture is a flat, all-transactional multi-statement script (rendered by
 * `renderPlanSql`), so replay is a single `pool.query()` on one connection —
 * the embedded leading `SET check_function_bodies = off` then covers every
 * forward-referencing function body in the same implicit-transaction batch.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Pool } from "pg";
import { SUPABASE_BARE_MAJOR } from "./containers.ts";

export function supabaseBaseInitFixturePath(
  major: number = SUPABASE_BARE_MAJOR,
): string {
  return join(
    import.meta.dir,
    "fixtures",
    "supabase-base-init",
    `${major}.sql`,
  );
}

export async function getSupabaseBaseInitSql(
  major: number = SUPABASE_BARE_MAJOR,
): Promise<string> {
  return readFile(supabaseBaseInitFixturePath(major), "utf8");
}

/** Replay the committed baseline fixture into `pool` (a fresh bare Supabase
 *  container). No-op for an empty fixture (bare already equals full). */
export async function applySupabaseBaseInit(
  pool: Pool,
  major: number = SUPABASE_BARE_MAJOR,
): Promise<void> {
  const sql = await getSupabaseBaseInitSql(major);
  if (sql.trim() === "") return;
  await pool.query(sql);
}
