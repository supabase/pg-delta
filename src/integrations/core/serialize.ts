import type { Change } from "../../change.types.ts";
import type { ChangeSerializer, DiffContext } from "../../main.ts";
import { AlterServerSetOptions } from "../../objects/foreign-data-wrapper/server/changes/server.alter.ts";
import { CreateServer } from "../../objects/foreign-data-wrapper/server/changes/server.create.ts";
import { Server } from "../../objects/foreign-data-wrapper/server/server.model.ts";
import { AlterUserMappingSetOptions } from "../../objects/foreign-data-wrapper/user-mapping/changes/user-mapping.alter.ts";
import { CreateUserMapping } from "../../objects/foreign-data-wrapper/user-mapping/changes/user-mapping.create.ts";
import { UserMapping } from "../../objects/foreign-data-wrapper/user-mapping/user-mapping.model.ts";
import { CreateRole } from "../../objects/role/changes/role.create.ts";
import { AlterSubscriptionSetConnection } from "../../objects/subscription/changes/subscription.alter.ts";
import { CreateSubscription } from "../../objects/subscription/changes/subscription.create.ts";
import { Subscription } from "../../objects/subscription/subscription.model.ts";
import type { IntegrationConfig } from "../integration.types.ts";
import { filterEnvDependentOptions } from "./env-dependent-utils.ts";

/**
 * Create a serialize function that applies masking to sensitive fields
 * and removes env-dependent options from ALTER statements.
 */
export function createChangeSerializer(
  config: IntegrationConfig,
): ChangeSerializer {
  return (_ctx: DiffContext, change: Change): string | undefined => {
    let transformedChange: Change | null = null;
    let warningComment = "";

    // First, remove env-dependent options from ALTER statements
    if (change instanceof AlterServerSetOptions && config.server?.filter) {
      const filteredOptions = filterEnvDependentOptions(
        change.options,
        config.server.filter,
      );
      if (filteredOptions.length === 0) {
        // All options were env-dependent, should have been filtered out earlier
        return undefined;
      }
      if (filteredOptions.length < change.options.length) {
        // Some options were removed, create new change instance
        transformedChange = new AlterServerSetOptions({
          server: change.server,
          options: filteredOptions,
        });
      }
    }

    if (
      change instanceof AlterUserMappingSetOptions &&
      config.userMapping?.filter
    ) {
      const filteredOptions = filterEnvDependentOptions(
        change.options,
        config.userMapping.filter,
      );
      if (filteredOptions.length === 0) {
        // All options were env-dependent, should have been filtered out earlier
        return undefined;
      }
      if (filteredOptions.length < change.options.length) {
        // Some options were removed, create new change instance
        transformedChange = new AlterUserMappingSetOptions({
          userMapping: change.userMapping,
          options: filteredOptions,
        });
      }
    }

    // Use transformed change if available, otherwise use original
    const changeToProcess = transformedChange ?? change;

    // Apply masking based on change type by creating masked change instances
    if (changeToProcess instanceof CreateRole) {
      const createRoleChange = changeToProcess;
      if (createRoleChange.role.can_login && config.role?.mask?.password) {
        const maskConfig = config.role.mask.password(
          createRoleChange.role.name,
        );
        warningComment = `-- WARNING: Role requires password to be set manually\n-- Set the password after migration execution using: ALTER ROLE ${createRoleChange.role.name} PASSWORD '${maskConfig.placeholder}';\n`;
        // No change instance needed - just add comment
      }
    }

    if (changeToProcess instanceof CreateSubscription) {
      if (config.subscription?.mask?.conninfo) {
        const maskConfig = config.subscription.mask.conninfo(
          changeToProcess.subscription.name,
        );
        warningComment = `-- WARNING: Connection string is environment-dependent\n-- ${maskConfig.instruction}\n`;
        // Create masked subscription with placeholder conninfo
        const maskedSubscription = new Subscription({
          name: changeToProcess.subscription.name,
          ...changeToProcess.subscription.dataFields,
          conninfo: maskConfig.placeholder,
        });
        transformedChange = new CreateSubscription({
          subscription: maskedSubscription,
        });
      }
    }

    if (changeToProcess instanceof AlterSubscriptionSetConnection) {
      if (changeToProcess.subscription && config.subscription?.mask?.conninfo) {
        const maskConfig = config.subscription.mask.conninfo(
          changeToProcess.subscription.name,
        );
        warningComment = `-- WARNING: Connection string is environment-dependent\n-- ${maskConfig.instruction}\n`;
        // Create masked subscription with placeholder conninfo
        const maskedSubscription = new Subscription({
          name: changeToProcess.subscription.name,
          ...changeToProcess.subscription.dataFields,
          conninfo: maskConfig.placeholder,
        });
        transformedChange = new AlterSubscriptionSetConnection({
          subscription: maskedSubscription,
        });
      }
    }

    if (changeToProcess instanceof CreateServer) {
      if (
        changeToProcess.server.options &&
        changeToProcess.server.options.length > 0 &&
        config.server?.mask
      ) {
        const masked = maskServerOptions(
          changeToProcess.server.options,
          changeToProcess.server.name,
          config.server.mask,
        );
        if (masked.fields.length > 0) {
          const optionKeys = masked.fields.map((f) => f.field).join(", ");
          warningComment = `-- WARNING: Server contains sensitive/environment-dependent options (${optionKeys})\n-- Set actual option values after migration execution using: ALTER SERVER ${changeToProcess.server.name} OPTIONS (SET ...);\n`;
          // Create masked server and change instance
          const maskedServer = new Server({
            ...changeToProcess.server.dataFields,
            name: changeToProcess.server.name,
            options: masked.masked,
          });
          transformedChange = new CreateServer({ server: maskedServer });
        }
      }
    }

    if (changeToProcess instanceof AlterServerSetOptions) {
      const alterChange = changeToProcess;
      if (alterChange.options && config.server?.mask) {
        const masked = maskServerOptionsInAlter(
          alterChange.options,
          alterChange.server.name,
          config.server.mask,
        );
        if (masked.fields.length > 0) {
          const optionKeys = masked.fields.map((f) => f.field).join(", ");
          warningComment = `-- WARNING: Server options contain sensitive/environment-dependent values (${optionKeys})\n-- Set actual option values after migration execution using: ALTER SERVER ${alterChange.server.name} OPTIONS (SET ...);\n`;
          // Create masked change instance with masked options
          transformedChange = new AlterServerSetOptions({
            server: alterChange.server,
            options: masked.masked,
          });
        }
      }
    }

    if (changeToProcess instanceof CreateUserMapping) {
      if (
        changeToProcess.userMapping.options &&
        changeToProcess.userMapping.options.length > 0 &&
        config.userMapping?.mask
      ) {
        const mappingId = `${changeToProcess.userMapping.server}:${changeToProcess.userMapping.user}`;
        const masked = maskUserMappingOptions(
          changeToProcess.userMapping.options,
          mappingId,
          config.userMapping.mask,
        );
        if (masked.fields.length > 0) {
          const optionKeys = masked.fields.map((f) => f.field).join(", ");
          warningComment = `-- WARNING: User mapping contains sensitive/environment-dependent options (${optionKeys})\n-- Set actual option values after migration execution using: ALTER USER MAPPING ... OPTIONS (SET ...);\n`;
          // Create masked user mapping and change instance
          const maskedUserMapping = new UserMapping({
            ...changeToProcess.userMapping.dataFields,
            user: changeToProcess.userMapping.user,
            server: changeToProcess.userMapping.server,
            options: masked.masked,
          });
          transformedChange = new CreateUserMapping({
            userMapping: maskedUserMapping,
          });
        }
      }
    }

    if (changeToProcess instanceof AlterUserMappingSetOptions) {
      const alterChange = changeToProcess;
      if (alterChange.options && config.userMapping?.mask) {
        const mappingId = `${alterChange.userMapping.server}:${alterChange.userMapping.user}`;
        const masked = maskUserMappingOptionsInAlter(
          alterChange.options,
          mappingId,
          config.userMapping.mask,
        );
        if (masked.fields.length > 0) {
          const optionKeys = masked.fields.map((f) => f.field).join(", ");
          warningComment = `-- WARNING: User mapping options contain sensitive/environment-dependent values (${optionKeys})\n-- Set actual option values after migration execution using: ALTER USER MAPPING ... OPTIONS (SET ...);\n`;
          // Create masked change instance with masked options
          transformedChange = new AlterUserMappingSetOptions({
            userMapping: alterChange.userMapping,
            options: masked.masked,
          });
        }
      }
    }

    // If transformation was applied, serialize the transformed change and add warning comment
    if (transformedChange || warningComment) {
      const sql = transformedChange
        ? transformedChange.serialize()
        : changeToProcess.serialize();
      return warningComment + sql;
    }

    // Return undefined if no masking was applied (fall back to default serialize)
    return undefined;
  };
}

/**
 * Mask server options based on sensitivity config
 */
function maskServerOptions(
  options: string[],
  serverName: string,
  config: NonNullable<IntegrationConfig["server"]>["mask"],
): { masked: string[]; fields: Array<{ field: string }> } {
  const masked: string[] = [];
  const fields: Array<{ field: string }> = [];

  if (!config) return { masked: options, fields: [] };

  // Options are [key1, value1, key2, value2, ...]
  for (let i = 0; i < options.length; i += 2) {
    if (i + 1 >= options.length) break;

    const key = options[i];
    const value = options[i + 1];

    // Check if this key should be masked
    let shouldMask = false;
    let placeholder = value;

    if (config.keys?.includes(key)) {
      shouldMask = true;
      placeholder = `__OPTION_${key.toUpperCase()}__`;
    } else if (config.patterns) {
      for (const pattern of config.patterns) {
        if (pattern.match.test(key)) {
          shouldMask = true;
          placeholder = pattern.placeholder(key, serverName);
          break;
        }
      }
    }

    if (shouldMask) {
      masked.push(key, placeholder);
      fields.push({ field: key });
    } else {
      masked.push(key, value);
    }
  }

  return { masked, fields };
}

/**
 * Mask server options in ALTER statement
 */
function maskServerOptionsInAlter(
  options: Array<{
    action: "ADD" | "SET" | "DROP";
    option: string;
    value?: string;
  }>,
  serverName: string,
  config: NonNullable<IntegrationConfig["server"]>["mask"],
): { masked: typeof options; fields: Array<{ field: string }> } {
  const masked: typeof options = [];
  const fields: Array<{ field: string }> = [];

  if (!config) return { masked: options, fields: [] };

  for (const opt of options) {
    if (opt.action === "DROP") {
      masked.push(opt);
      continue;
    }

    const key = opt.option;
    let shouldMask = false;
    let placeholder = opt.value ?? "";

    if (config.keys?.includes(key)) {
      shouldMask = true;
      placeholder = `__OPTION_${key.toUpperCase()}__`;
    } else if (config.patterns) {
      for (const pattern of config.patterns) {
        if (pattern.match.test(key)) {
          shouldMask = true;
          placeholder = pattern.placeholder(key, serverName);
          break;
        }
      }
    }

    if (shouldMask && opt.value !== undefined) {
      masked.push({ ...opt, value: placeholder });
      fields.push({ field: key });
    } else {
      masked.push(opt);
    }
  }

  return { masked, fields };
}

/**
 * Mask user mapping options
 */
function maskUserMappingOptions(
  options: string[],
  mappingId: string,
  config: NonNullable<IntegrationConfig["userMapping"]>["mask"],
): { masked: string[]; fields: Array<{ field: string }> } {
  const masked: string[] = [];
  const fields: Array<{ field: string }> = [];

  if (!config) return { masked: options, fields: [] };

  // Options are [key1, value1, key2, value2, ...]
  for (let i = 0; i < options.length; i += 2) {
    if (i + 1 >= options.length) break;

    const key = options[i];
    const value = options[i + 1];

    let shouldMask = false;
    let placeholder = value;

    if (config.keys?.includes(key)) {
      shouldMask = true;
      placeholder = `__OPTION_${key.toUpperCase()}__`;
    } else if (config.patterns) {
      for (const pattern of config.patterns) {
        if (pattern.match.test(key)) {
          shouldMask = true;
          placeholder = pattern.placeholder(key, mappingId);
          break;
        }
      }
    }

    if (shouldMask) {
      masked.push(key, placeholder);
      fields.push({ field: key });
    } else {
      masked.push(key, value);
    }
  }

  return { masked, fields };
}

/**
 * Mask user mapping options in ALTER statement
 */
function maskUserMappingOptionsInAlter(
  options: Array<{
    action: "ADD" | "SET" | "DROP";
    option: string;
    value?: string;
  }>,
  mappingId: string,
  config: NonNullable<IntegrationConfig["userMapping"]>["mask"],
): { masked: typeof options; fields: Array<{ field: string }> } {
  const masked: typeof options = [];
  const fields: Array<{ field: string }> = [];

  if (!config) return { masked: options, fields: [] };

  for (const opt of options) {
    if (opt.action === "DROP") {
      masked.push(opt);
      continue;
    }

    const key = opt.option;
    let shouldMask = false;
    let placeholder = opt.value ?? "";

    if (config.keys?.includes(key)) {
      shouldMask = true;
      placeholder = `__OPTION_${key.toUpperCase()}__`;
    } else if (config.patterns) {
      for (const pattern of config.patterns) {
        if (pattern.match.test(key)) {
          shouldMask = true;
          placeholder = pattern.placeholder(key, mappingId);
          break;
        }
      }
    }

    if (shouldMask && opt.value !== undefined) {
      masked.push({ ...opt, value: placeholder });
      fields.push({ field: key });
    } else {
      masked.push(opt);
    }
  }

  return { masked, fields };
}
