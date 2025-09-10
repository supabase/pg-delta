/**
 * Format function arguments for CREATE/DROP FUNCTION statements.
 *
 * @param argNames - Array of argument names (can be null)
 * @param argTypes - Array of argument types (required)
 * @param argModes - Array of argument modes (can be null)
 * @returns Formatted argument string
 */
export function formatFunctionArguments(
  argNames: string[] | null,
  argTypes: string[] | null,
  argModes: string[] | null,
): string {
  const names = argNames ?? [];
  const types = argTypes ?? [];
  const modes = argModes ?? [];

  if (types.length === 0) {
    return "";
  }

  const modeMap: Record<string, string> = {
    i: "IN",
    o: "OUT",
    b: "INOUT",
    v: "VARIADIC",
    t: "TABLE",
  };

  return types
    .map((type, i) => {
      const name = names[i] ?? ""; // already quoted in model, if present
      const mode = modes[i] ? modeMap[modes[i]] : "";

      const parts: string[] = [];
      if (mode) parts.push(mode);
      if (name) parts.push(name);
      parts.push(type);

      return parts.join(" ");
    })
    .join(", ");
}

/**
 * Format a GUC value for SET ... TO ... in function/procedure definitions.
 * Applies quoting rules consistent with PostgreSQL docs and psql style.
 */
export function formatConfigValue(key: string, rawValue: string): string {
  const value = rawValue.trim();
  if (value.length === 0) return value;
  const lowerKey = key.toLowerCase();
  if (value.startsWith("'") && value.endsWith("'")) return value;
  if (/^(true|false|on|off)$/i.test(value)) return value.toLowerCase();
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return value;
  if (lowerKey === "search_path" || value.includes(",")) return value;
  return `'${value.replace(/'/g, "''")}'`;
}
