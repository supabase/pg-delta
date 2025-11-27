import type { Change } from "../../change.types.ts";
import type { ChangeFilter, DiffContext } from "../../main.ts";
import { AlterServerSetOptions } from "../../objects/foreign-data-wrapper/server/changes/server.alter.ts";
import { AlterUserMappingSetOptions } from "../../objects/foreign-data-wrapper/user-mapping/changes/user-mapping.alter.ts";
import { AlterSubscriptionSetConnection } from "../../objects/subscription/changes/subscription.alter.ts";
import type { IntegrationConfig } from "../integration.types.ts";
import { areAllOptionsEnvDependent } from "./env-dependent-utils.ts";

/**
 * Create a filter function that filters out env-dependent changes.
 * This filter only checks if changes should be included or excluded.
 * Option removal is handled in serialize.ts.
 */
export function createChangeFilter(config: IntegrationConfig): ChangeFilter {
  return (_ctx: DiffContext, change: Change): boolean => {
    // Subscription: filter if only conninfo changed
    if (
      change instanceof AlterSubscriptionSetConnection &&
      config.subscription?.filter?.includes("conninfo")
    ) {
      return false;
    }

    // Server: filter out if all options are env-dependent SET actions
    if (change instanceof AlterServerSetOptions) {
      if (
        change.options &&
        change.options.length > 0 &&
        areAllOptionsEnvDependent(change.options, config.server?.filter)
      ) {
        return false;
      }
    }

    // User mapping: filter out if all options are env-dependent SET actions
    if (change instanceof AlterUserMappingSetOptions) {
      if (
        change.options &&
        change.options.length > 0 &&
        areAllOptionsEnvDependent(change.options, config.userMapping?.filter)
      ) {
        return false;
      }
    }

    return true;
  };
}
