/**
 * The Supabase integration profile: the handlers + policy that define the
 * managed view for a Supabase-hosted PostgreSQL database.
 *
 * This is purely a COMPOSITION — the handler mechanism (pg_partman, …) and the
 * policy DSL are generic; the Supabase profile selects a set of them. Selecting
 * `supabaseProfile` (or `--profile supabase` on the CLI) is the one safe,
 * discoverable way to get Supabase semantics; nothing else should hand-assemble
 * the recipe.
 */
import type { ExtensionHandler } from "../extract/handler.ts";
import {
  makePgCronHandler,
  pgPartmanHandler,
} from "../policy/extensions/index.ts";
import { supabasePolicy } from "../policy/supabase.ts";
import type { IntegrationProfile } from "./profile.ts";

/**
 * The pg_cron handler bound to Supabase's role identities. The handler itself
 * is platform-neutral; the two Supabase facts live here:
 *
 * - `defaultJobOwner` — `postgres` both owns ordinary cron jobs and executes
 *   the plan, so its username is elided from the replay (pg_cron demands
 *   SUPERUSER for a non-NULL username, and Cloud's `postgres` is not one).
 *   Sourced from `supabasePolicy.defaultOwner`, the single place that already
 *   names the profile's assumed executor for `ALTER … OWNER TO`.
 * - `jobOwnerAliases` — CLI-1435: jobs scheduled before the ownership fix were
 *   recorded under `supabase_read_only_user`.
 */
const supabasePgCronHandler = makePgCronHandler({
  ...(supabasePolicy.defaultOwner !== undefined
    ? { defaultJobOwner: supabasePolicy.defaultOwner }
    : {}),
  jobOwnerAliases: { supabase_read_only_user: "postgres" },
});

/** The stateful-extension handlers the Supabase integration composes. */
export const SUPABASE_EXTENSION_HANDLERS: readonly ExtensionHandler[] = [
  pgPartmanHandler,
  supabasePgCronHandler,
];

export const supabaseProfile: IntegrationProfile = {
  id: "supabase",
  handlers: SUPABASE_EXTENSION_HANDLERS,
  policy: supabasePolicy,
};
