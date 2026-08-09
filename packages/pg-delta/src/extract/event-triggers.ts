/** Event triggers (cluster-level, function-backed). */
import type { StableId } from "../core/stable-id.ts";
import { type ExtractContext, notExtensionMember } from "./scope.ts";

export async function extractEventTriggers(ctx: ExtractContext): Promise<void> {
  const { q, pushWithMeta, pushOwnerEdge } = ctx;
  // ── event triggers ───────────────────────────────────────────────────
  for (const row of await q(`
    SELECT e.evtname AS name, e.evtevent AS event, e.evtenabled AS enabled,
           COALESCE(e.evttags, '{}')::text[] AS tags,
           pn.nspname AS func_schema, p.proname AS func_name,
           r.rolname AS owner,
           obj_description(e.oid, 'pg_event_trigger') AS comment
    FROM pg_event_trigger e
    JOIN pg_proc p ON p.oid = e.evtfoid
    JOIN pg_namespace pn ON pn.oid = p.pronamespace
    JOIN pg_roles r ON r.oid = e.evtowner
    WHERE ${notExtensionMember("pg_event_trigger", "e.oid")}
    ORDER BY e.evtname`)) {
    const evtId: StableId = { kind: "eventTrigger", name: String(row["name"]) };
    pushWithMeta(
      {
        id: evtId,
        payload: {
          event: String(row["event"]),
          enabled: String(row["enabled"]),
          tags: (row["tags"] as string[]).map(String).sort(),
          functionSchema: String(row["func_schema"]),
          functionName: String(row["func_name"]),
        },
      },
      row,
    );
    pushOwnerEdge(evtId, row["owner"]);
  }
}
