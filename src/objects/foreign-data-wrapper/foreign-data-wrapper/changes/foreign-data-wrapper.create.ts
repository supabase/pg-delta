import { quoteLiteral } from "../../../base.change.ts";
import { stableId } from "../../../utils.ts";
import type { ForeignDataWrapper } from "../foreign-data-wrapper.model.ts";
import { CreateForeignDataWrapperChange } from "./foreign-data-wrapper.base.ts";

/**
 * Create a foreign data wrapper.
 *
 * @see https://www.postgresql.org/docs/17/sql-createforeigndatawrapper.html
 *
 * Synopsis
 * ```sql
 * CREATE FOREIGN DATA WRAPPER name
 *     [ HANDLER handler_function | NO HANDLER ]
 *     [ VALIDATOR validator_function | NO VALIDATOR ]
 *     [ OPTIONS ( option 'value' [, ... ] ) ]
 * ```
 */
export class CreateForeignDataWrapper extends CreateForeignDataWrapperChange {
  public readonly foreignDataWrapper: ForeignDataWrapper;
  public readonly scope = "object" as const;

  constructor(props: { foreignDataWrapper: ForeignDataWrapper }) {
    super();
    this.foreignDataWrapper = props.foreignDataWrapper;
  }

  get creates() {
    return [this.foreignDataWrapper.stableId];
  }

  get requires() {
    const dependencies = new Set<string>();

    // Owner dependency
    dependencies.add(stableId.role(this.foreignDataWrapper.owner));

    // Handler function dependency (if specified)
    if (this.foreignDataWrapper.handler) {
      // Handler is stored as "schema.function_name(args)"
      // We need to parse it to get the procedure stableId
      // For now, we'll skip this dependency as it's complex to parse
      // TODO: Parse handler function reference to add procedure dependency
    }

    // Validator function dependency (if specified)
    if (this.foreignDataWrapper.validator) {
      // Similar to handler
      // TODO: Parse validator function reference to add procedure dependency
    }

    return Array.from(dependencies);
  }

  serialize(): string {
    const parts: string[] = ["CREATE FOREIGN DATA WRAPPER"];

    // Add FDW name
    parts.push(this.foreignDataWrapper.name);

    // Add HANDLER clause
    if (this.foreignDataWrapper.handler) {
      parts.push("HANDLER", this.foreignDataWrapper.handler);
    } else {
      parts.push("NO HANDLER");
    }

    // Add VALIDATOR clause
    if (this.foreignDataWrapper.validator) {
      parts.push("VALIDATOR", this.foreignDataWrapper.validator);
    } else {
      parts.push("NO VALIDATOR");
    }

    // Add OPTIONS clause
    if (
      this.foreignDataWrapper.options &&
      this.foreignDataWrapper.options.length > 0
    ) {
      const optionPairs: string[] = [];
      for (let i = 0; i < this.foreignDataWrapper.options.length; i += 2) {
        if (i + 1 < this.foreignDataWrapper.options.length) {
          optionPairs.push(
            `${this.foreignDataWrapper.options[i]} ${quoteLiteral(this.foreignDataWrapper.options[i + 1])}`,
          );
        }
      }
      if (optionPairs.length > 0) {
        parts.push(`OPTIONS (${optionPairs.join(", ")})`);
      }
    }

    return parts.join(" ");
  }
}
