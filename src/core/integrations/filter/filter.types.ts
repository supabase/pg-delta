import type { Change } from "../../change.types.ts";

export type ChangeFilter = (change: Change) => boolean;
