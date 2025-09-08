import { AlterChange, ReplaceChange } from "../../base.change.ts";
import type { Procedure } from "../procedure.model.ts";
import { CreateProcedure } from "./procedure.create.ts";
import { DropProcedure } from "./procedure.drop.ts";

/**
 * Alter a procedure.
 *
 * @see https://www.postgresql.org/docs/17/sql-alterfunction.html
 *
 * Synopsis
 * ```sql
 * ALTER FUNCTION name ( [ [ argmode ] [ argname ] argtype [, ...] ] )
 *     action [, ... ] [ RESTRICT ]
 * ALTER PROCEDURE name ( [ [ argmode ] [ argname ] argtype [, ...] ] )
 *     action [, ... ] [ RESTRICT ]
 * where action is one of:
 *     [ EXTERNAL ] SECURITY INVOKER | [ EXTERNAL ] SECURITY DEFINER
 *     SET configuration_parameter { TO | = } { value | DEFAULT }
 *     SET configuration_parameter FROM CURRENT
 *     RESET configuration_parameter
 *     RESET ALL
 *     [ EXTERNAL ] SECURITY INVOKER | [ EXTERNAL ] SECURITY DEFINER
 *     SET configuration_parameter { TO | = } { value | DEFAULT }
 *     SET configuration_parameter FROM CURRENT
 *     RESET configuration_parameter
 *     RESET ALL
 * ```
 */
type AlterProcedure =
  | AlterProcedureChangeOwner
  | AlterProcedureSetSecurity
  | AlterProcedureSetConfig
  | AlterProcedureSetVolatility
  | AlterProcedureSetStrictness
  | AlterProcedureSetLeakproof
  | AlterProcedureSetParallel;

/**
 * ALTER FUNCTION/PROCEDURE ... OWNER TO ...
 */
export class AlterProcedureChangeOwner extends AlterChange {
  public readonly main: Procedure;
  public readonly branch: Procedure;

  constructor(props: { main: Procedure; branch: Procedure }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
  }

  get stableId(): string {
    return `${this.main.stableId}`;
  }

  serialize(): string {
    const objectType = this.main.kind === "p" ? "PROCEDURE" : "FUNCTION";

    return [
      "ALTER",
      objectType,
      `${this.main.schema}.${this.main.name}`,
      "OWNER TO",
      this.branch.owner,
    ].join(" ");
  }
}

/**
 * ALTER FUNCTION/PROCEDURE ... SECURITY { INVOKER | DEFINER }
 */
export class AlterProcedureSetSecurity extends AlterChange {
  public readonly main: Procedure;
  public readonly branch: Procedure;

  constructor(props: { main: Procedure; branch: Procedure }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
  }

  get stableId(): string {
    return `${this.main.stableId}`;
  }

  serialize(): string {
    const objectType = this.main.kind === "p" ? "PROCEDURE" : "FUNCTION";
    const security = this.branch.security_definer
      ? "SECURITY DEFINER"
      : "SECURITY INVOKER"; // INVOKER is default; only emitted when changed via diff

    return [
      "ALTER",
      objectType,
      `${this.main.schema}.${this.main.name}`,
      security,
    ].join(" ");
  }
}

/**
 * ALTER FUNCTION/PROCEDURE ... SET/RESET configuration_parameter
 * Emits individual RESET for removed keys and SET for added/changed keys.
 */
export class AlterProcedureSetConfig extends AlterChange {
  public readonly main: Procedure;
  public readonly branch: Procedure;

  constructor(props: { main: Procedure; branch: Procedure }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
  }

  get stableId(): string {
    return `${this.main.stableId}`;
  }

  serialize(): string {
    const parseOptions = (options: string[] | null | undefined) => {
      const map = new Map<string, string>();
      if (!options) return map;
      for (const opt of options) {
        const eqIndex = opt.indexOf("=");
        const key = opt.slice(0, eqIndex).trim();
        const value = opt.slice(eqIndex + 1).trim();
        map.set(key, value);
      }
      return map;
    };

    const mainMap = parseOptions(this.main.config);
    const branchMap = parseOptions(this.branch.config);

    const head = [
      "ALTER",
      this.main.kind === "p" ? "PROCEDURE" : "FUNCTION",
      `${this.main.schema}.${this.main.name}`,
    ].join(" ");

    const statements: string[] = [];

    // Removed or changed keys -> RESET key
    for (const [key, oldValue] of mainMap.entries()) {
      const hasInBranch = branchMap.has(key);
      const newValue = branchMap.get(key);
      const changed = hasInBranch ? oldValue !== newValue : true;
      if (changed) {
        statements.push(`${head} RESET ${key}`);
      }
    }

    // Added or changed keys -> SET key=value
    for (const [key, newValue] of branchMap.entries()) {
      const oldValue = mainMap.get(key);
      if (oldValue !== newValue) {
        statements.push(`${head} SET ${key}=${newValue}`);
      }
    }

    return statements.join(";\n");
  }
}

/**
 * ALTER FUNCTION/PROCEDURE ... { IMMUTABLE | STABLE | VOLATILE }
 */
export class AlterProcedureSetVolatility extends AlterChange {
  public readonly main: Procedure;
  public readonly branch: Procedure;

  constructor(props: { main: Procedure; branch: Procedure }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
  }

  get stableId(): string {
    return `${this.main.stableId}`;
  }

  serialize(): string {
    const objectType = this.main.kind === "p" ? "PROCEDURE" : "FUNCTION";
    const volMap: Record<string, string> = {
      i: "IMMUTABLE",
      s: "STABLE",
      v: "VOLATILE",
    };
    return [
      "ALTER",
      objectType,
      `${this.main.schema}.${this.main.name}`,
      volMap[this.branch.volatility],
    ].join(" ");
  }
}

/**
 * ALTER FUNCTION/PROCEDURE ... { STRICT | CALLED ON NULL INPUT }
 */
export class AlterProcedureSetStrictness extends AlterChange {
  public readonly main: Procedure;
  public readonly branch: Procedure;

  constructor(props: { main: Procedure; branch: Procedure }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
  }

  get stableId(): string {
    return `${this.main.stableId}`;
  }

  serialize(): string {
    const objectType = this.main.kind === "p" ? "PROCEDURE" : "FUNCTION";
    const strictness = this.branch.is_strict
      ? "STRICT"
      : "CALLED ON NULL INPUT";
    return [
      "ALTER",
      objectType,
      `${this.main.schema}.${this.main.name}`,
      strictness,
    ].join(" ");
  }
}

/**
 * ALTER FUNCTION/PROCEDURE ... { LEAKPROOF | NOT LEAKPROOF }
 */
export class AlterProcedureSetLeakproof extends AlterChange {
  public readonly main: Procedure;
  public readonly branch: Procedure;

  constructor(props: { main: Procedure; branch: Procedure }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
  }

  get stableId(): string {
    return `${this.main.stableId}`;
  }

  serialize(): string {
    const objectType = this.main.kind === "p" ? "PROCEDURE" : "FUNCTION";
    const leak = this.branch.leakproof ? "LEAKPROOF" : "NOT LEAKPROOF";
    return [
      "ALTER",
      objectType,
      `${this.main.schema}.${this.main.name}`,
      leak,
    ].join(" ");
  }
}

/**
 * ALTER FUNCTION/PROCEDURE ... PARALLEL { UNSAFE | RESTRICTED | SAFE }
 */
export class AlterProcedureSetParallel extends AlterChange {
  public readonly main: Procedure;
  public readonly branch: Procedure;

  constructor(props: { main: Procedure; branch: Procedure }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
  }

  get stableId(): string {
    return `${this.main.stableId}`;
  }

  serialize(): string {
    const objectType = this.main.kind === "p" ? "PROCEDURE" : "FUNCTION";
    const parallelMap: Record<string, string> = {
      u: "PARALLEL UNSAFE",
      s: "PARALLEL SAFE",
      r: "PARALLEL RESTRICTED",
    };
    return [
      "ALTER",
      objectType,
      `${this.main.schema}.${this.main.name}`,
      parallelMap[this.branch.parallel_safety],
    ].join(" ");
  }
}

/**
 * Replace a procedure by dropping and recreating it.
 * This is used when properties that cannot be altered via ALTER FUNCTION/PROCEDURE change.
 */
export class ReplaceProcedure extends ReplaceChange {
  public readonly main: Procedure;
  public readonly branch: Procedure;

  constructor(props: { main: Procedure; branch: Procedure }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
  }

  get stableId(): string {
    return `${this.main.stableId}`;
  }

  serialize(): string {
    const dropChange = new DropProcedure({ procedure: this.main });
    const createChange = new CreateProcedure({ procedure: this.branch });

    return [dropChange.serialize(), createChange.serialize()].join(";\n");
  }
}
