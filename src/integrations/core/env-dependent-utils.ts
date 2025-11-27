/**
 * Shared utilities for handling env-dependent options in ALTER statements.
 */

type AlterOption = {
  action: "ADD" | "SET" | "DROP";
  option: string;
  value?: string;
};

/**
 * Creates a set of env-dependent keys, or null if all SET actions should be filtered.
 * If envDependentKeys is undefined or empty, returns null (meaning filter all SET actions).
 */
function createEnvDependentKeysSet(
  envDependentKeys?: string[],
): Set<string> | null {
  const filterAllSetActions =
    !envDependentKeys || envDependentKeys.length === 0;
  return filterAllSetActions ? null : new Set(envDependentKeys);
}

/**
 * Checks if an option is env-dependent.
 * Returns true if the option is a SET action and the key is in the env-dependent set
 * (or if all SET actions should be filtered).
 */
function _isEnvDependentOption(
  option: AlterOption,
  envDependentKeys?: string[],
): boolean {
  if (option.action !== "SET") {
    return false;
  }
  const envDependentKeysSet = createEnvDependentKeysSet(envDependentKeys);
  // If envDependentKeysSet is null, all SET actions are env-dependent
  return envDependentKeysSet === null || envDependentKeysSet.has(option.option);
}

/**
 * Checks if all options in an array are env-dependent SET actions.
 * Returns true if there are no non-env-dependent options (including ADD/DROP actions).
 */
export function areAllOptionsEnvDependent(
  options: AlterOption[],
  envDependentKeys?: string[],
): boolean {
  if (options.length === 0) {
    return false;
  }
  const envDependentKeysSet = createEnvDependentKeysSet(envDependentKeys);
  // Check if there's at least one non-env-dependent option
  const hasNonEnvDependent = options.some(
    (opt) =>
      opt.action !== "SET" ||
      (envDependentKeysSet !== null && !envDependentKeysSet.has(opt.option)),
  );
  return !hasNonEnvDependent;
}

/**
 * Filters out env-dependent SET options from an array of options.
 * Keeps ADD/DROP actions and non-env-dependent SET actions.
 */
export function filterEnvDependentOptions(
  options: AlterOption[],
  envDependentKeys?: string[],
): AlterOption[] {
  const envDependentKeysSet = createEnvDependentKeysSet(envDependentKeys);
  return options.filter(
    (opt) =>
      opt.action !== "SET" ||
      (envDependentKeysSet !== null && !envDependentKeysSet.has(opt.option)),
  );
}
