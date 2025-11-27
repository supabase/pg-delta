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
        instruction: `Role ${roleName} requires a password to be set manually. Run: ALTER ROLE ${roleName} PASSWORD '<your-password-here>';`,
      }),
    },
  },
  subscription: {
    filter: ["conninfo"],
    mask: {
      conninfo: (subName) => ({
        placeholder:
          "host=__CONN_HOST__ port=__CONN_PORT__ dbname=__CONN_DBNAME__ user=__CONN_USER__ password=__CONN_PASSWORD__",
        instruction: `Replace the placeholder values (__CONN_HOST__, __CONN_PORT__, __CONN_DBNAME__, __CONN_USER__, __CONN_PASSWORD__) in the connection string with actual values for subscription ${subName}, or run ALTER SUBSCRIPTION ${subName} CONNECTION after this script.`,
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
            `Replace __OPTION_${key.toUpperCase()}__ with the actual ${key} value for server ${serverName}, or run ALTER SERVER ${serverName} after this script.`,
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
          instruction: (key, mappingId) =>
            `Replace __OPTION_${key.toUpperCase()}__ with the actual ${key} value for user mapping ${mappingId}, or run ALTER USER MAPPING after this script.`,
        },
      ],
    },
  },
};
