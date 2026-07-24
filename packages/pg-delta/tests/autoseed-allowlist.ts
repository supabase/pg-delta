/**
 * Allowlist of EXPECTED class-23 auto-seed skips in the corpus proof loop.
 *
 * The engine suite (`engine.test.ts`) runs every corpus scenario with
 * `provePlan({ autoSeed: true })`, which best-effort seeds each empty kept
 * table with `INSERT ... DEFAULT VALUES` so the data-preservation check has
 * teeth. A table whose every column is nullable/defaulted seeds cleanly; a
 * table with a NOT NULL-without-default / FK / unique / check column cannot be
 * seeded that way and the driver returns a class-23 SQLSTATE.
 *
 * A skip has one of two `reasonCode` shapes, both expected and both gated here:
 *   - a class-23 SQLSTATE (`23502` NOT NULL w/o default, `23503` FK, `23505`
 *     unique, `23514` check, …) — the insert was rejected; or
 *   - the synthetic sentinel `"no_row"` (NOT a SQLSTATE) — the insert RESOLVED
 *     but the row is absent from the final pre-apply snapshot: a BEFORE INSERT
 *     trigger returned NULL, a DO INSTEAD rule suppressed it, or an AFTER INSERT
 *     trigger deleted it (possibly while seeding a later table). rowCount is
 *     only the command tag, so persistence is judged by reconciling against
 *     that snapshot — nothing was actually seeded.
 * Both must be declared here, keyed precisely by
 * `{ scenario, direction, table, reasonCode }`, so a NEW unseedable table (or a
 * skip that silently appears in an unexpected scenario) fails the suite loudly
 * instead of quietly losing data-preservation coverage. Anything the seeder
 * classifies as `failed` (a raised exception, connection/permission error,
 * etc.) is never allowlistable and always fails the scenario.
 *
 * Maintenance: before adding an entry here, prefer giving the scenario a hand
 * -written row instead — extend `corpus/<scenario>/seed.sql` (forward skips) or
 * `corpus/<scenario>/seed-b.sql` (reverse skips) with one minimal row that
 * satisfies the table's constraints, which upgrades the table from EMPTY to real
 * fingerprint/count coverage. Only allowlist what genuinely can't (or shouldn't)
 * be seeded: a row a trigger/rule suppresses, or a scenario whose whole point is
 * a constraint interplay. The harness prints a machine-readable `SEED_AUDIT
 * {json}` line to stderr for every non-allowlisted skip before failing. Add the
 * reported `{ scenario, direction, table, reasonCode }` here (keep the list
 * sorted by scenario, then direction, then schema.name) only after confirming
 * the table is genuinely unseedable-with-defaults — never to paper over a
 * `failed` outcome or a real data-preservation hazard. Every entry must be
 * observed when its scenario/direction runs; a now-seedable table makes the
 * exemption stale and fails the coverage gate until the entry is removed.
 */

/** A precise identity for one tolerated class-23 skip. `reasonCode` is the
 *  SQLSTATE (`23502` NOT NULL w/o default, `23503` FK, `23505` unique,
 *  `23514` check, …). No bare table names: every field is required so an
 *  unexpected scenario/direction/reason is NOT silently swallowed. */
export interface SeedSkipKey {
  scenario: string;
  direction: "forward" | "reverse";
  table: { schema: string; name: string };
  reasonCode: string;
}

export const AUTOSEED_SKIP_ALLOWLIST: readonly SeedSkipKey[] = [
  // 1 entry — every formerly-allowlisted class-23 (23502) table is now hand-seeded
  // via a corpus seed.sql / seed-b.sql (see the module header), including
  // `alter-table--generated-column`'s `test_schema.calculations`, which is seeded
  // at the (2, 2) fixed point of both generation expressions (2 + 2 = 2 * 2 = 4) so
  // the stored generated value is byte-identical across the expression swap and the
  // content fingerprint holds. The sole remaining entry is a "no_row" case: a
  // BEFORE INSERT trigger that RETURNS NULL, suppressing the row.
  // Sorted by scenario, then direction, then schema.name.
  {
    scenario: "trigger-operations--trigger-drop-before-function-drop",
    direction: "forward",
    table: { schema: "test_schema", name: "foo" },
    reasonCode: "no_row",
  },
];

const keyOf = (k: SeedSkipKey): string =>
  JSON.stringify([
    k.scenario,
    k.direction,
    k.table.schema,
    k.table.name,
    k.reasonCode,
  ]);

const ALLOWED: ReadonlySet<string> = new Set(
  AUTOSEED_SKIP_ALLOWLIST.map(keyOf),
);

/** True when this exact class-23 skip is a declared, expected non-seed. Strict:
 *  an unknown scenario/direction/table/reasonCode combination is NOT allowed. */
export function isSeedSkipAllowed(
  scenario: string,
  direction: "forward" | "reverse",
  table: { schema: string; name: string },
  reasonCode: string,
): boolean {
  return ALLOWED.has(keyOf({ scenario, direction, table, reasonCode }));
}

/** Declared skips for one executed corpus direction. The coverage gate uses
 *  this to reject exemptions that are no longer observed, so a future loss of
 *  coverage cannot silently reuse a dormant allowlist entry. */
export function seedSkipAllowlistFor(
  scenario: string,
  direction: "forward" | "reverse",
): readonly SeedSkipKey[] {
  return AUTOSEED_SKIP_ALLOWLIST.filter(
    (entry) => entry.scenario === scenario && entry.direction === direction,
  );
}
