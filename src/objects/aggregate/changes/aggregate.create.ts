import { quoteLiteral } from "../../base.change.ts";
import type { Aggregate } from "../aggregate.model.ts";
import { CreateAggregateChange } from "./aggregate.base.ts";

/**
 * Create an aggregate.
 *
 * @see https://www.postgresql.org/docs/17/sql-createaggregate.html
 */
export class CreateAggregate extends CreateAggregateChange {
  public readonly aggregate: Aggregate;
  public readonly orReplace: boolean;
  public readonly scope = "object" as const;

  constructor(props: { aggregate: Aggregate; orReplace?: boolean }) {
    super();
    this.aggregate = props.aggregate;
    this.orReplace = props.orReplace ?? false;
  }

  get creates() {
    return [this.aggregate.stableId];
  }

  serialize(): string {
    const signature = this.aggregate.identityArguments;
    const qualifiedName = `${this.aggregate.schema}.${this.aggregate.name}`;
    const head = [
      "CREATE",
      this.orReplace ? "OR REPLACE" : null,
      "AGGREGATE",
      `${qualifiedName}${signature ? `(${signature})` : "()"}`,
    ]
      .filter(Boolean)
      .join(" ");

    const clauses: string[] = [];

    clauses.push(`SFUNC = ${formatProc(this.aggregate.transition_function)}`);
    clauses.push(`STYPE = ${this.aggregate.state_data_type}`);

    if (this.aggregate.state_data_space > 0) {
      clauses.push(`SSPACE = ${this.aggregate.state_data_space}`);
    }

    if (this.aggregate.final_function) {
      clauses.push(`FINALFUNC = ${formatProc(this.aggregate.final_function)}`);
    }
    if (this.aggregate.final_function_extra_args) {
      clauses.push("FINALFUNC_EXTRA");
    }
    if (this.aggregate.final_function_modify) {
      clauses.push(
        `FINALFUNC_MODIFY = ${formatModify(this.aggregate.final_function_modify)}`,
      );
    }

    if (this.aggregate.combine_function) {
      clauses.push(
        `COMBINEFUNC = ${formatProc(this.aggregate.combine_function)}`,
      );
    }
    if (this.aggregate.serial_function) {
      clauses.push(
        `SERIALFUNC = ${formatProc(this.aggregate.serial_function)}`,
      );
    }
    if (this.aggregate.deserial_function) {
      clauses.push(
        `DESERIALFUNC = ${formatProc(this.aggregate.deserial_function)}`,
      );
    }

    if (this.aggregate.initial_condition !== null) {
      clauses.push(
        `INITCOND = ${quoteLiteral(this.aggregate.initial_condition)}`,
      );
    }

    if (this.aggregate.moving_transition_function) {
      clauses.push(
        `MSFUNC = ${formatProc(this.aggregate.moving_transition_function)}`,
      );
    }
    if (this.aggregate.moving_inverse_function) {
      clauses.push(
        `MINVFUNC = ${formatProc(this.aggregate.moving_inverse_function)}`,
      );
    }
    if (this.aggregate.moving_state_data_type) {
      clauses.push(`MSTYPE = ${this.aggregate.moving_state_data_type}`);
    }
    if (
      this.aggregate.moving_state_data_space &&
      this.aggregate.moving_state_data_space > 0
    ) {
      clauses.push(`MSSPACE = ${this.aggregate.moving_state_data_space}`);
    }
    if (this.aggregate.moving_final_function) {
      clauses.push(
        `MFINALFUNC = ${formatProc(this.aggregate.moving_final_function)}`,
      );
    }
    if (this.aggregate.moving_final_function_extra_args) {
      clauses.push("MFINALFUNC_EXTRA");
    }
    if (this.aggregate.moving_final_function_modify) {
      clauses.push(
        `MFINALFUNC_MODIFY = ${formatModify(this.aggregate.moving_final_function_modify)}`,
      );
    }
    if (this.aggregate.moving_initial_condition !== null) {
      clauses.push(
        `MINITCOND = ${quoteLiteral(this.aggregate.moving_initial_condition)}`,
      );
    }

    if (this.aggregate.sort_operator) {
      clauses.push(`SORTOP = ${formatOperator(this.aggregate.sort_operator)}`);
    }

    if (this.aggregate.parallel_safety !== "u") {
      clauses.push(
        `PARALLEL ${formatParallel(this.aggregate.parallel_safety)}`,
      );
    }

    if (this.aggregate.is_strict) {
      clauses.push("STRICT");
    }

    if (this.aggregate.aggkind === "h") {
      clauses.push("HYPOTHETICAL");
    }

    const body = clauses.length
      ? `(
  ${clauses.join(",\n  ")}
)`
      : "()";

    return `${head}
${body}`;
  }
}

function formatProc(proc: string): string {
  const idx = proc.indexOf("(");
  return idx === -1 ? proc : proc.slice(0, idx);
}

function formatOperator(op: string): string {
  const idx = op.indexOf("(");
  const qualified = idx === -1 ? op : op.slice(0, idx);
  return `OPERATOR(${qualified})`;
}

function formatModify(code: string): string {
  switch (code) {
    case "r":
      return "READ_ONLY";
    case "s":
      return "SHAREABLE";
    case "w":
      return "READ_WRITE";
    default:
      return code;
  }
}

function formatParallel(code: string): string {
  switch (code) {
    case "s":
      return "SAFE";
    case "r":
      return "RESTRICTED";
    default:
      return "UNSAFE";
  }
}
