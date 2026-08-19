/**
 * supabase_vault handler (docs/architecture/vault.md, CLI-1434).
 *
 * Presence-only: the generic extension path already diffs
 * `CREATE`/`DROP EXTENSION supabase_vault`. This handler emits no facts and
 * no intent kinds. It exists so that:
 *
 *   1. `schema apply` can fail early via `shadowPrecheck` when declarative
 *      files call `vault.create_secret` / `vault.update_secret` (or create
 *      the extension) against a shadow that does not ship supabase_vault.
 *   2. `vaultPresenceDiagnostics` (called from `plan()`) can attach a
 *      `vault_presence` warning when the plan creates the extension while
 *      the desired side has catalog-structural dependents, or drops it
 *      (destroying `vault.secrets`).
 *
 * The engine never reads `vault.secrets` (or pgsodium keys). "Vault in use"
 * is a best-effort catalog-structural signal: a kept fact with a `depends`
 * edge onto a `supabase_vault` member (or a member's non-satellite
 * descendant — a column of `vault.decrypted_secrets`, a vault type, …).
 * A LANGUAGE sql function that selects from a vault view often records
 * *no* pg_depend when `check_function_bodies` is off (Supabase default),
 * so the signal is typically a user view or typed column. If no edge
 * exists, a CREATE degrades to the no-warning path — acceptable.
 *
 * Wired into the `raw` profile (the user-visible alpine-shadow failure).
 * Not added to the supabase profile: vault is platform-filtered there.
 */
import { encodeId, type StableId } from "../../core/stable-id.ts";
import { VAULT_PRESENCE, type Diagnostic } from "../../core/diagnostic.ts";
import type { FactBase } from "../../core/fact.ts";
import type { ExtensionHandler } from "../../extract/handler.ts";
import { extensionMemberClosure } from "../view.ts";

const VAULT_EXTENSION = "supabase_vault";

const vaultId: StableId = { kind: "extension", name: VAULT_EXTENSION };

const CREATE_EXTENSION_RE =
  /\bcreate\s+extension\s+(?:if\s+not\s+exists\s+)?(?:"supabase_vault"|supabase_vault\b)/i;
const VAULT_FN_RE = /\bvault\s*\.\s*(?:create_secret|update_secret)\s*\(/i;
const CREATE_EXTENSION_SQL_RE = /CREATE EXTENSION "supabase_vault"/;
const DROP_EXTENSION_SQL_RE = /DROP EXTENSION "supabase_vault"/;

/**
 * True when `fb` has a kept (non-reference-only, non-member) fact with a
 * `depends` edge onto a `supabase_vault` extension member. Best-effort:
 * we never SELECT from `vault.secrets`.
 */
function vaultIsInUse(fb: FactBase): boolean {
  if (!fb.has(vaultId)) return false;
  const memberKeys = new Set<string>();
  for (const [key, exts] of extensionMemberClosure(fb)) {
    if (
      exts.some(
        (ext) => ext.kind === "extension" && ext.name === VAULT_EXTENSION,
      )
    ) {
      memberKeys.add(key);
    }
  }
  if (memberKeys.size === 0) return false;
  for (const edge of fb.edges) {
    if (edge.kind !== "depends") continue;
    if (!memberKeys.has(encodeId(edge.to))) continue;
    if (memberKeys.has(encodeId(edge.from))) continue;
    if (fb.isReferenceOnly(edge.from)) continue;
    if (!fb.has(edge.from)) continue;
    return true;
  }
  return false;
}

/** Plan-time `vault_presence` warnings. `actions` is the finalized list. */
export function vaultPresenceDiagnostics(
  desired: FactBase,
  actions: ReadonlyArray<{ verb: string; sql: string }>,
): Diagnostic[] {
  const out: Diagnostic[] = [];
  const creating = actions.some(
    (a) => a.verb === "create" && CREATE_EXTENSION_SQL_RE.test(a.sql),
  );
  if (creating && vaultIsInUse(desired)) {
    out.push({
      code: VAULT_PRESENCE,
      severity: "warning",
      subject: vaultId,
      message:
        "CREATE EXTENSION supabase_vault will enable Vault on the target, but secret values and keys are not part of the schema and will not be migrated. Re-create them on the target via the Vault section of the dashboard or the management API.",
    });
  }
  const dropping = actions.some(
    (a) => a.verb === "drop" && DROP_EXTENSION_SQL_RE.test(a.sql),
  );
  if (dropping) {
    out.push({
      code: VAULT_PRESENCE,
      severity: "warning",
      subject: vaultId,
      message:
        "DROP EXTENSION supabase_vault will destroy vault.secrets (a table member). Secret values and keys are not part of the schema and will be lost; re-create them via the Vault section of the dashboard or the management API if they are still needed.",
    });
  }
  return out;
}

export const vaultHandler: ExtensionHandler = {
  extension: VAULT_EXTENSION,
  async capture() {
    return { facts: [], edges: [] };
  },
  shadowPrecheck: {
    matchesStatement(masked) {
      return CREATE_EXTENSION_RE.test(masked) || VAULT_FN_RE.test(masked);
    },
    async capable(query) {
      const rows = await query(
        `SELECT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'supabase_vault') AS avail`,
      );
      const row = rows[0] as { avail: boolean } | undefined;
      if (row === undefined || !row.avail) {
        return {
          capable: false,
          reason:
            "the shadow/target Postgres does not ship supabase_vault; use a Supabase image or remove vault statements from the schema files",
        };
      }
      return { capable: true };
    },
  },
};
