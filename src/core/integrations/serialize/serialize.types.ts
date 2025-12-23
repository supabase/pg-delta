import type { Change } from "../../change.types.ts";

export type ChangeSerializer = (change: Change) => string | undefined;
