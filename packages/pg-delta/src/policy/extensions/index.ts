/**
 * Generic stateful-extension handlers (docs/architecture/extension-intent.md §4.1).
 *
 * A handler reads ONE extension's own catalogs and emits `managedBy` provenance
 * edges on the objects that extension created operationally. The handler
 * contract lives in the extract layer (`src/extract/handler.ts`) because
 * `extract` invokes handlers inside its own snapshot-bound transaction; this
 * barrel only re-exports the contract for convenience and collects the concrete
 * handlers.
 *
 * There is no `extractWithHandlers` / `extractManaged` anymore: handlers are
 * passed to `extract(pool, { handlers })` (so they run on the core snapshot),
 * and `resolveView` is the single projection point that drops `managedBy` facts
 * from the diffed view. The Supabase composition of these handlers lives in the
 * integration profile (`src/integrations/supabase.ts`).
 */
export type {
  CaptureResult,
  ExtensionHandler,
  HandlerContext,
} from "../../extract/handler.ts";
export { pgPartmanHandler } from "./pg-partman.ts";
export {
  makePgCronHandler,
  type PgCronHandlerConfig,
  pgCronHandler,
} from "./pg-cron.ts";
