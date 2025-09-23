import { DEBUG } from "../../../../tests/constants.ts";
import type { TableLikeObject } from "../../base.model.ts";
import type { Index } from "../index.model.ts";

export function checkIsSerializable(
  index: Index,
  indexableObject?: TableLikeObject,
) {
  if (
    index.index_expressions === null &&
    (indexableObject === undefined || indexableObject.columns.length === 0)
  ) {
    if (DEBUG) {
      console.log(`index: ${JSON.stringify(index, null, 2)}`);
      console.log(
        `indexableObject: ${JSON.stringify(indexableObject, null, 2)}`,
      );
    }
    throw new Error(
      "Index requires an indexableObject with columns when key_columns are used",
    );
  }
}
