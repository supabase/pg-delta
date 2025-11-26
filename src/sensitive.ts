import type { SensitiveInfo } from "./sensitive.types.ts";

/**
 * Mask all options in an array of option key-value pairs with placeholders.
 * Options are expected to be in the format: [key1, value1, key2, value2, ...]
 * All option values are replaced with placeholders that users need to fill in.
 *
 * @param options - Array of option strings (key-value pairs)
 * @param objectType - Type of object (e.g., "server", "user_mapping")
 * @param objectName - Name of the object
 * @returns Object with masked options array and sensitive info metadata
 */
export function maskSensitiveOptions(
  options: string[] | null | undefined,
  objectType: "server" | "user_mapping",
  objectName: string,
): {
  masked: string[];
  sensitive: SensitiveInfo[];
} {
  if (!options || options.length === 0) {
    return { masked: [], sensitive: [] };
  }

  const masked: string[] = [];
  const sensitive: SensitiveInfo[] = [];

  // Options are stored as [key1, value1, key2, value2, ...]
  for (let i = 0; i < options.length; i += 2) {
    if (i + 1 >= options.length) break;

    const key = options[i];
    const _value = options[i + 1];

    // Mask all options with placeholders
    const placeholder = `__OPTION_${key.toUpperCase()}__`;
    masked.push(key, placeholder);

    const type =
      objectType === "server" ? "server_option" : "user_mapping_option";
    sensitive.push({
      type,
      objectType,
      objectName,
      field: key,
      placeholder,
      instruction: `Replace ${placeholder} with the actual ${key} value for ${objectType} ${objectName}, or run ALTER ${objectType.toUpperCase()} after this script.`,
    });
  }

  return { masked, sensitive };
}

/**
 * Mask password in a PostgreSQL connection string (conninfo).
 * Connection strings can contain passwords in various formats:
 * - password=secret
 * - password='secret'
 * - password="secret"
 *
 * @param conninfo - PostgreSQL connection string
 * @returns Object with masked conninfo and flag indicating if password was found
 */
export function maskConninfo(conninfo: string): {
  masked: string;
  hadPassword: boolean;
} {
  // Match password=value patterns, handling various quoting styles
  // This regex matches: password=value, password='value', password="value"
  const passwordPattern = /password\s*=\s*(?:'([^']*)'|"([^"]*)"|([^\s]+))/gi;

  let hadPassword = false;

  // Use replace with a function to handle all matches correctly
  const masked = conninfo.replace(passwordPattern, (_match) => {
    hadPassword = true;
    // Replace the entire match with password=__SENSITIVE_PASSWORD__
    return "password=__SENSITIVE_PASSWORD__";
  });

  return { masked, hadPassword };
}
