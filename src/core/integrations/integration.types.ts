import type { ChangeFilter } from "./filter/filter.types.ts";
import type { ChangeSerializer } from "./serialize/serialize.types.ts";

export type Integration = {
  filter?: ChangeFilter;
  serialize?: ChangeSerializer;
};
