/**
 * Filter out SET actions from option changes, keeping only ADD and DROP.
 * This ensures we only diff on key addition and removal, not value changes.
 */
export function filterServerEnvDependentOptions(
  options: Array<{
    action: "ADD" | "SET" | "DROP";
    option: string;
    value?: string;
  }>,
): Array<{
  action: "ADD" | "SET" | "DROP";
  option: string;
  value?: string;
}> {
  return options.filter((opt) => opt.action !== "SET");
}

/**
 * Filter out SET actions from option changes, keeping only ADD and DROP.
 * This ensures we only diff on key addition and removal, not value changes.
 */
export function filterUserMappingEnvDependentOptions(
  options: Array<{
    action: "ADD" | "SET" | "DROP";
    option: string;
    value?: string;
  }>,
): Array<{
  action: "ADD" | "SET" | "DROP";
  option: string;
  value?: string;
}> {
  return options.filter((opt) => opt.action !== "SET");
}
