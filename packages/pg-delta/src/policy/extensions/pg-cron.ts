/**
 * pg_cron handler (docs/architecture/extension-intent.md §3.2).
 *
 * pg_cron always creates its `cron.job` table in a fixed `cron` schema,
 * regardless of which schema the extension itself is installed into (often
 * `pg_catalog` on Supabase) — so capture detects the extension via
 * `pg_extension`/`pg_namespace` (like partman) but always reads `cron.job`
 * directly.
 *
 * Each row becomes an `extensionIntent` fact keyed by `jobname` (the only
 * stable, user-chosen identity pg_cron offers — `jobid` is a runtime
 * sequence value and cannot be used as a declarative key). A job with no
 * name, or two jobs sharing a name, cannot be keyed at all: both cases are
 * surfaced as an `INTENT_UNKEYED` diagnostic instead of a fact, and NEVER
 * reach the `FactBase` (which throws on a duplicate id).
 */
import type { DependencyEdge, Fact, FactBase } from "../../core/fact.ts";
import { INTENT_UNKEYED, type Diagnostic } from "../../core/diagnostic.ts";
import type {
  CaptureResult,
  ExtensionHandler,
  HandlerContext,
} from "../../extract/handler.ts";
import type { IntentKindRule } from "../../plan/rules.ts";
import { lit } from "../../plan/render.ts";
import type { StableId } from "../../core/stable-id.ts";

const PG_CRON: StableId = { kind: "extension", name: "pg_cron" };

/** CLI-1435: jobs scheduled before the ownership fix were recorded under
 *  `supabase_read_only_user`. Normalize to `postgres` on capture so a
 *  rebuild (unschedule + reschedule) never reproduces the legacy owner. */
const LEGACY_JOB_OWNER = "supabase_read_only_user";
const NORMALIZED_JOB_OWNER = "postgres";

/** Resolve whether pg_cron is installed (any schema — often `pg_catalog` on
 *  Supabase). Returns true/false; the handler always queries `cron.job`
 *  directly since pg_cron creates that schema regardless of install schema. */
async function detect(ctx: HandlerContext): Promise<boolean> {
  const rows = await ctx.query(
    `SELECT n.nspname AS schema
       FROM pg_extension e
       JOIN pg_namespace n ON n.oid = e.extnamespace
      WHERE e.extname = 'pg_cron'`,
  );
  return rows.length > 0;
}

interface CronJobRow {
  jobid: number;
  jobname: string | null;
  schedule: string;
  command: string;
  database: string;
  username: string;
  active: boolean;
}

function jobIntentId(jobname: string): StableId {
  return {
    kind: "extensionIntent",
    ext: "pg_cron",
    intentKind: "job",
    key: jobname,
  };
}

/** First ~60 chars of a command, for diagnostic messages (never full text —
 *  commands can be arbitrarily large SQL). */
function commandPreview(command: string): string {
  return command.length > 60 ? `${command.slice(0, 60)}…` : command;
}

export const pgCronHandler: ExtensionHandler = {
  extension: "pg_cron",

  async capture(
    ctx: HandlerContext,
    current: FactBase,
  ): Promise<CaptureResult> {
    const installed = await detect(ctx);
    if (!installed) return { facts: [], edges: [] };

    const rows = (await ctx.query(
      `SELECT jobid, jobname, schedule, command, database, username, active
         FROM cron.job`,
    )) as unknown as CronJobRow[];

    const diagnostics: Diagnostic[] = [];
    // group named rows by jobname to detect duplicates before ever building a
    // fact — the FactBase throws on a duplicate id, so a collision must be
    // caught here.
    const byName = new Map<string, CronJobRow[]>();

    for (const row of rows) {
      const jobname = row.jobname;
      if (jobname === null || jobname === "") {
        diagnostics.push({
          code: INTENT_UNKEYED,
          severity: "warning",
          message:
            `pg_cron job ${row.jobid} (command: ${commandPreview(row.command)}) ` +
            `has no jobname and cannot be managed declaratively; name it via ` +
            `cron.schedule('<name>', …)`,
          context: { ext: "pg_cron", intentKind: "job" },
        });
        continue;
      }
      const group = byName.get(jobname) ?? [];
      group.push(row);
      byName.set(jobname, group);
    }

    const facts: Fact[] = [];
    const edges: DependencyEdge[] = [];
    const dependsOnExtension = current.has(PG_CRON);

    for (const [jobname, group] of byName) {
      if (group.length > 1) {
        diagnostics.push({
          code: INTENT_UNKEYED,
          severity: "warning",
          message:
            `pg_cron jobname '${jobname}' is used by ${group.length} jobs ` +
            `(jobids ${group.map((r) => r.jobid).join(", ")}) and cannot be ` +
            `managed declaratively; jobnames must be unique to be keyed`,
          context: { ext: "pg_cron", intentKind: "job" },
        });
        continue;
      }

      const row = group[0] as CronJobRow;
      const username =
        row.username === LEGACY_JOB_OWNER ? NORMALIZED_JOB_OWNER : row.username;
      const id = jobIntentId(jobname);
      facts.push({
        id,
        payload: {
          schedule: row.schedule,
          command: row.command,
          database: row.database,
          username,
          active: row.active,
        },
      });
      if (dependsOnExtension) {
        edges.push({ from: id, to: PG_CRON, kind: "depends" });
      }
    }

    return { facts, edges, diagnostics };
  },

  intentKinds: {
    job: {
      payloadAttrs: ["schedule", "command", "database", "username", "active"],
      create(fact) {
        const key = (fact.id as Extract<StableId, { kind: "extensionIntent" }>)
          .key;
        const p = fact.payload as {
          schedule: string;
          command: string;
          database: string;
          username: string;
          active: boolean;
        };
        // Replay ALL captured fields deterministically via the 6-arg
        // `cron.schedule_in_database(job_name, schedule, command, database,
        // username, active)`. The 3-arg `cron.schedule` form would always
        // (re)create the job in the CURRENT database, active, owned by the
        // executing user — so a job that is inactive, targets another
        // database, or has a non-current username would never converge. The
        // 6-arg signature has been stable since pg_cron 1.4 (2021), which
        // every supported PostgreSQL image and the supabase/postgres image
        // ship, so this stays compatible across the pg_cron versions we
        // target. String args keep `lit()` quoting; `active` is a bare
        // boolean literal.
        return [
          {
            sql:
              `select cron.schedule_in_database(${lit(key)}, ${lit(p.schedule)}, ` +
              `${lit(p.command)}, ${lit(p.database)}, ${lit(p.username)}, ${p.active})`,
          },
        ];
      },
      drop(fact) {
        const key = (fact.id as Extract<StableId, { kind: "extensionIntent" }>)
          .key;
        return {
          sql: `select cron.unschedule(${lit(key)})`,
          dataLoss: "none",
        };
      },
    } satisfies IntentKindRule,
  },

  // pg_cron's schedule* functions run ONLY in the cluster's `cron.database_name`
  // (default `postgres`). A co-located shadow database `schema apply` creates is
  // never that database, so a declarative dir containing cron intent could never
  // load there. Detect it and fail early with a clear remediation instead of a
  // mid-load "function cron.schedule_in_database does not exist" stuck error.
  shadowPrecheck: {
    matchesStatement(masked) {
      // `cron.<fn>(` survives literal masking (unquoted schema + function name);
      // this is the intent replay a cron export/schema always contains.
      return /\bcron\s*\.\s*(schedule|schedule_in_database|unschedule|alter_job)\s*\(/i.test(
        masked,
      );
    },
    async capable(query) {
      const rows = await query(
        `SELECT current_setting('cron.database_name', true) AS db,
                current_database() AS cur,
                EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') AS avail`,
      );
      const row = rows[0] as
        | { db: string | null; cur: string; avail: boolean }
        | undefined;
      if (row === undefined || !row.avail) {
        return {
          capable: false,
          reason:
            "pg_cron is not available in the shadow (not in shared_preload_libraries)",
        };
      }
      if (row.db === null || row.db !== row.cur) {
        return {
          capable: false,
          reason: `the shadow database "${row.cur}" is not the cron database (cron.database_name = ${row.db === null ? "unset" : `"${row.db}"`})`,
        };
      }
      return { capable: true };
    },
  },
};
