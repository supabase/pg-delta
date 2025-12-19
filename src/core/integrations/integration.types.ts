import type { ChangeFilter, ChangeSerializer } from "../main.ts";

export type Integration = {
  filter?: ChangeFilter;
  serialize?: ChangeSerializer;
};
