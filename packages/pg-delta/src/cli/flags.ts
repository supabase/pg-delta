/**
 * Minimal typed flag parser shared by all CLI command handlers.
 *
 * Usage:
 *   const { flags, positionals } = parseFlags(args, {
 *     source:  { type: "value", required: true },
 *     desired: { type: "value", required: true },
 *     compact: { type: "boolean" },
 *     out:     { type: "value" },
 *   });
 *
 * - "value" flags consume the next argv token as their value.
 * - "boolean" flags are true when present, absent = undefined.
 * - "multi" flags are repeatable; each occurrence appends one value; result is string[].
 * - required: true on a "value" flag makes parseFlags throw a UsageError when absent.
 * - Unknown flags throw a UsageError (exit code 2 semantics).
 * - Positional args (non-flag tokens) are collected into `positionals`.
 */

export class UsageError extends Error {
  readonly exitCode = 2;
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

/**
 * Request a specific process exit code from `main()` without a generic
 * "Error:" banner. Command handlers use this for operation-result exits
 * (apply failed → 1, drift detected → 1, render no-op → 3, blocking
 * diagnostics → 3, …) so command bodies NEVER call `process.exit` directly —
 * `main()` is the sole exiter. A command writes its own human output to
 * stdout/stderr first, then throws `CliExit(code)`; `main()` just maps the
 * code. Keeping command bodies exit-free is what makes them safe to call
 * in-process (tests, embedders): a stray `process.exit` inside a command would
 * otherwise tear down the whole host process (e.g. the bun test runner).
 */
export class CliExit extends Error {
  constructor(readonly code: number) {
    super(`process exit ${code}`);
    this.name = "CliExit";
  }
}

export type FlagSpec =
  | { type: "value"; required?: boolean }
  | { type: "boolean" }
  | { type: "multi" };

export type FlagsDef = Record<string, FlagSpec>;

/** Infer the result type from a FlagsDef. */
export type ParsedFlags<T extends FlagsDef> = {
  [K in keyof T]: T[K] extends { type: "boolean" }
    ? boolean
    : T[K] extends { type: "multi" }
      ? string[]
      : T[K] extends { type: "value"; required: true }
        ? string
        : string | undefined;
};

export interface ParseResult<T extends FlagsDef> {
  flags: ParsedFlags<T>;
  positionals: string[];
}

export function parseFlags<T extends FlagsDef>(
  args: string[],
  spec: T,
): ParseResult<T> {
  // initialise result with defaults
  const result: Record<string, boolean | string | string[] | undefined> = {};
  for (const [name, def] of Object.entries(spec)) {
    if (def.type === "boolean") {
      result[name] = false;
    } else if (def.type === "multi") {
      result[name] = [];
    } else {
      result[name] = undefined;
    }
  }

  const positionals: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string; // i < args.length guarantees defined
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }

    const flagName = arg.slice(2); // strip "--"
    const def = spec[flagName];

    if (def === undefined) {
      throw new UsageError(`Unknown flag: --${flagName}`);
    }

    if (def.type === "boolean") {
      result[flagName] = true;
    } else if (def.type === "value") {
      const next = args[i + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new UsageError(`Flag --${flagName} requires a value`);
      }
      result[flagName] = next;
      i++;
    } else {
      // multi
      const next = args[i + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new UsageError(`Flag --${flagName} requires a value`);
      }
      (result[flagName] as string[]).push(next);
      i++;
    }
  }

  // check required value flags
  for (const [name, def] of Object.entries(spec)) {
    if (def.type === "value" && def.required && result[name] === undefined) {
      throw new UsageError(`Missing required flag: --${name}`);
    }
  }

  return { flags: result as ParsedFlags<T>, positionals };
}
