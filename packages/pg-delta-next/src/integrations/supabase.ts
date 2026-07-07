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
import { pgCronHandler, pgPartmanHandler } from "../policy/extensions/index.ts";
import { supabasePolicy } from "../policy/supabase.ts";
import type { IntegrationProfile } from "./profile.ts";

/** The stateful-extension handlers the Supabase integration composes. */
export const SUPABASE_EXTENSION_HANDLERS: readonly ExtensionHandler[] = [
  pgPartmanHandler,
  pgCronHandler,
];

export const supabaseProfile: IntegrationProfile = {
  id: "supabase",
  handlers: SUPABASE_EXTENSION_HANDLERS,
  policy: supabasePolicy,
};
