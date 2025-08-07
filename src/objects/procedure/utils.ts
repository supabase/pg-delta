import { quoteIdentifier } from "../base.change.ts";

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
      const name = names[i] ?? "";
      const mode = modes[i] ? modeMap[modes[i]] : "";

      const parts: string[] = [];
      if (mode) parts.push(mode);
      if (name) parts.push(quoteIdentifier(name));
      parts.push(type);

      return parts.join(" ");
    })
    .join(", ");
}
