import type { Aggregate } from "../aggregate.model.ts";
import { DropAggregateChange } from "./aggregate.base.ts";

/**
 * Drop an aggregate.
 *
 * @see https://www.postgresql.org/docs/17/sql-dropaggregate.html
 */
export class DropAggregate extends DropAggregateChange {
  public readonly aggregate: Aggregate;
  public readonly scope = "object" as const;

  constructor(props: { aggregate: Aggregate }) {
    super();
    this.aggregate = props.aggregate;
  }

  get drops() {
    return [this.aggregate.stableId];
  }

  get requires() {
    return [this.aggregate.stableId];
  }

  serialize(): string {
    const signature = this.aggregate.identityArguments;
    const qualifiedName = `${this.aggregate.schema}.${this.aggregate.name}`;
    const withArgs = signature.length > 0 ? `(${signature})` : "()";
    return `DROP AGGREGATE ${qualifiedName}${withArgs}`;
  }
}
