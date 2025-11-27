import type { ChangeFilter, ChangeSerializer } from "../main.ts";

/**
 * Unified configuration for integration behavior.
 * Combines filtering (env-dependent) and masking (sensitive) configurations.
 */
export interface IntegrationConfig {
  role?: {
    /**
     * Fields to filter out completely (env-dependent).
     * These cause the entire change to be dropped if it ONLY contains these fields.
     */
    filter?: ("password" | "validUntil")[];
    /**
     * Fields to mask (sensitive).
     * Maps field names to placeholder generators.
     */
    mask?: {
      password?: (roleName: string) => {
        placeholder: string;
        instruction: string;
      };
    };
  };
  subscription?: {
    /**
     * Fields to filter out completely (env-dependent).
     */
    filter?: "conninfo"[];
    /**
     * Fields to mask (sensitive).
     */
    mask?: {
      conninfo?: (subName: string) => {
        placeholder: string;
        instruction: string;
      };
    };
  };
  server?: {
    /**
     * Fields to filter out completely (env-dependent).
     * FDW-specific, provided by integration.
     */
    filter?: string[];
    /**
     * Fields to mask (sensitive).
     * Pattern-based for unknown FDW options.
     */
    mask?: {
      patterns?: Array<{
        match: RegExp;
        placeholder: (key: string, serverName: string) => string;
        instruction?: (key: string, serverName: string) => string;
      }>;
      // Or explicit keys
      keys?: string[];
    };
  };
  userMapping?: {
    /**
     * Fields to filter out completely (env-dependent).
     * FDW-specific, provided by integration.
     */
    filter?: string[];
    /**
     * Fields to mask (sensitive).
     * Pattern-based for unknown FDW options.
     */
    mask?: {
      patterns?: Array<{
        match: RegExp;
        placeholder: (key: string, mappingId: string) => string;
        instruction?: (key: string, mappingId: string) => string;
      }>;
      keys?: string[];
    };
  };
}

export type Integration = {
  filter?: ChangeFilter;
  serialize?: ChangeSerializer;
};
