import type { Node } from "@supabase/pg-parser/17/types";
import { isString } from "./guards.ts";

export type ObjectIdentifier = {
  id: string; // schema.name
  schema: string; // schema name
  name: string; // object name
};

export function getObjectIdentifier(names: Node[]): ObjectIdentifier {
  // Handle simple name (defaults to public schema)
  if (names.length === 1 && isString(names[0])) {
    return {
      id: `public.${names[0].String.sval}`,
      schema: "public",
      name: names[0].String.sval,
    };
  }

  // Handle schema-qualified name
  if (names.length === 2 && isString(names[0]) && isString(names[1])) {
    return {
      id: `${names[0].String.sval}.${names[1].String.sval}`,
      schema: names[0].String.sval,
      name: names[1].String.sval,
    };
  }

  throw new Error(`Invalid object name: ${JSON.stringify(names)}`);
}
