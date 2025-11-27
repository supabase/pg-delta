import type { IntegrationConfig } from "../integration.types.ts";

/**
 * Default integration configuration.
 * Filters known env-dependent fields and masks sensitive data.
 */
export const defaultConfig: IntegrationConfig = {
  role: {
    filter: ["password"],
    mask: {
      password: (roleName) => ({
        placeholder: "<your-password-here>",
        instruction: `Set the password after migration execution using: ALTER ROLE ${roleName} PASSWORD '<your-password-here>';`,
      }),
    },
  },
  subscription: {
    filter: ["conninfo"],
    mask: {
      conninfo: (subName) => ({
        placeholder:
          "host=__CONN_HOST__ port=__CONN_PORT__ dbname=__CONN_DBNAME__ user=__CONN_USER__ password=__CONN_PASSWORD__",
        instruction: `Set the connection string after migration execution using: ALTER SUBSCRIPTION ${subName} CONNECTION '...';`,
      }),
    },
  },
  server: {
    // Don't filter any - can't know what's env-dependent for unknown FDWs
    filter: [],
    // Mask all options by default (safe for unknown FDWs)
    mask: {
      patterns: [
        {
          match: /.*/, // Match everything
          placeholder: (key, _serverName) => `__OPTION_${key.toUpperCase()}__`,
          instruction: (key, serverName) =>
            `Set actual option values after migration execution using: ALTER SERVER ${serverName} OPTIONS (SET ${key} '...');`,
        },
      ],
    },
  },
  userMapping: {
    // Don't filter any - can't know what's env-dependent for unknown FDWs
    filter: [],
    // Mask all options by default (safe for unknown FDWs)
    mask: {
      patterns: [
        {
          match: /.*/, // Match everything
          placeholder: (key, _mappingId) => `__OPTION_${key.toUpperCase()}__`,
          instruction: (key, _mappingId) =>
            `Set actual option values after migration execution using: ALTER USER MAPPING ... OPTIONS (SET ${key} '...');`,
        },
      ],
    },
  },
};
