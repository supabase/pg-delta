import {
  createObjectRefFromAst,
  dedupeObjectRefs,
  normalizeIdentifier,
  normalizeSignature,
  objectRefKey,
  splitQualifiedName,
} from "../model/object-ref.ts";
import type {
  AnnotationHints,
  Diagnostic,
  ObjectKind,
  ObjectRef,
  PhaseTag,
} from "../model/types.ts";
import { OBJECT_KINDS } from "../model/types.ts";
import { splitTopLevel } from "../utils/split-top-level.ts";

const PHASES = new Set<PhaseTag>([
  "bootstrap",
  "pre_data",
  "data_structures",
  "routines",
  "post_data",
  "privileges",
]);

const leadingAnnotationLines = (sql: string): string[] => {
  const lines = sql.split(/\r?\n/u);
  const result: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    if (trimmed.startsWith("--")) {
      result.push(line);
      continue;
    }
    break;
  }

  return result;
};

const ANNOTATABLE_OBJECT_KINDS = new Set<string>(OBJECT_KINDS);

const parseKind = (rawValue: string): ObjectKind | null => {
  const normalized = normalizeIdentifier(rawValue).toLowerCase();
  if (!ANNOTATABLE_OBJECT_KINDS.has(normalized)) {
    return null;
  }
  return normalized as ObjectKind;
};

const indexOfCharOutsideQuotesAndParens = (
  value: string,
  targetChar: string,
): number => {
  let inQuotes = false;
  let depth = 0;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const nextChar = value[index + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        index += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }

    if (!inQuotes) {
      // Check target before updating depth so targetChar "(" or ")" at depth 0 is returned, not consumed.
      // Necessary for function annotations with signatures like "function:app.do_work(int,uuid)"
      if (depth === 0 && char === targetChar) {
        return index;
      }
      if (char === "(") {
        depth += 1;
      } else if (char === ")") {
        depth = Math.max(0, depth - 1);
      }
    }
  }

  return -1;
};

const parseKindQualifiedObject = (
  rawValue: string,
): { ref: ObjectRef | null; error?: string } => {
  const separatorIndex = rawValue.indexOf(":");
  if (separatorIndex <= 0) {
    return {
      ref: null,
      error: `Expected '<kind>:<schema.name>' but got '${rawValue}'.`,
    };
  }

  const kindText = rawValue.slice(0, separatorIndex);
  const objectText = rawValue.slice(separatorIndex + 1);

  const kind = parseKind(kindText);
  if (!kind) {
    return { ref: null, error: `Unknown object kind '${kindText}'.` };
  }

  let objectNameText = objectText.trim();
  let signature: string | undefined;

  const signatureStart = indexOfCharOutsideQuotesAndParens(objectNameText, "(");
  if (signatureStart >= 0 && objectNameText.endsWith(")")) {
    signature = normalizeSignature(objectNameText.slice(signatureStart));
    objectNameText = objectNameText.slice(0, signatureStart).trim();
  } else {
    const signatureSeparator = indexOfCharOutsideQuotesAndParens(
      objectNameText,
      ":",
    );
    if (signatureSeparator > 0) {
      signature = normalizeSignature(
        objectNameText.slice(signatureSeparator + 1),
      );
      objectNameText = objectNameText.slice(0, signatureSeparator).trim();
    }
  }

  const { schema, name } = splitQualifiedName(objectNameText, "raw");
  if (!name) {
    return { ref: null, error: `Missing object name in '${rawValue}'.` };
  }

  return { ref: createObjectRefFromAst(kind, name, schema, signature) };
};

export const parseAnnotations = (
  sql: string,
): { annotations: AnnotationHints; diagnostics: Diagnostic[] } => {
  const diagnostics: Diagnostic[] = [];
  const annotations: AnnotationHints = {
    dependsOn: [],
    requires: [],
    provides: [],
  };
  const requiresByKey = new Set<string>();
  const providesByKey = new Set<string>();
  let phaseSeen = false;

  const lines = leadingAnnotationLines(sql);
  for (const line of lines) {
    const match = line.match(/^\s*--\s*pg-topo:(\w+)\s+(.+?)\s*$/u);
    if (!match) {
      continue;
    }

    const directive = match[1] ?? "";
    const value = match[2] ?? "";

    if (directive === "phase") {
      if (phaseSeen) {
        diagnostics.push({
          code: "INVALID_ANNOTATION",
          message: "Duplicate phase annotation is not allowed.",
        });
        continue;
      }
      const phaseValue = normalizeIdentifier(value) as PhaseTag;
      if (!PHASES.has(phaseValue)) {
        diagnostics.push({
          code: "INVALID_ANNOTATION",
          message: `Invalid phase annotation '${value}'.`,
          suggestedFix:
            "Use one of: bootstrap, pre_data, data_structures, routines, post_data, privileges.",
        });
        continue;
      }
      annotations.phase = phaseValue;
      phaseSeen = true;
      continue;
    }

    if (directive === "depends_on") {
      const items = splitTopLevel(value, ",");
      for (const item of items) {
        const { schema, name } = splitQualifiedName(item, "raw");
        if (!name) {
          diagnostics.push({
            code: "INVALID_ANNOTATION",
            message: `Invalid depends_on annotation '${item}'.`,
          });
          continue;
        }
        annotations.dependsOn.push(
          createObjectRefFromAst("table", name, schema),
        );
      }
      continue;
    }

    if (directive === "requires" || directive === "provides") {
      const { ref, error } = parseKindQualifiedObject(value);
      if (!ref) {
        diagnostics.push({
          code: "INVALID_ANNOTATION",
          message: error ?? `Invalid ${directive} annotation '${value}'.`,
        });
        continue;
      }
      if (directive === "requires") {
        annotations.requires.push(ref);
        requiresByKey.add(objectRefKey(ref));
      } else {
        annotations.provides.push(ref);
        providesByKey.add(objectRefKey(ref));
      }
      continue;
    }

    diagnostics.push({
      code: "INVALID_ANNOTATION",
      message: `Unknown annotation directive '${directive}'.`,
    });
  }

  for (const requireKey of requiresByKey) {
    if (!providesByKey.has(requireKey)) {
      continue;
    }
    diagnostics.push({
      code: "INVALID_ANNOTATION",
      message: `Object '${requireKey}' cannot be both requires and provides on the same statement.`,
    });
  }

  return {
    annotations: {
      phase: annotations.phase,
      dependsOn: dedupeObjectRefs(annotations.dependsOn),
      requires: dedupeObjectRefs(annotations.requires),
      provides: dedupeObjectRefs(annotations.provides),
    },
    diagnostics,
  };
};
