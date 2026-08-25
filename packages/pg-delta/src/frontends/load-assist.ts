/**
 * Shadow-load assist warnings: structured locations plus the user-facing
 * copy that tells an author how to fix file order vs statement order vs
 * session poisoning.
 */

export type LoadAssistLocation = {
  file: string;
  line?: number;
  excerpt?: string;
};

export type LoadAssistFailure = LoadAssistLocation & {
  error?: string;
  after?: LoadAssistLocation;
};

export function compactSqlExcerpt(sql: string): string {
  const text = sql.replace(/\s+/g, " ").trim();
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

export function errorWithoutLocation(message: string): string {
  const idx = message.lastIndexOf(" — at line ");
  return idx === -1 ? message : message.slice(0, idx);
}

export function formatAssistLocation(loc: LoadAssistLocation): string {
  const at = loc.line !== undefined ? `${loc.file}:${loc.line}` : loc.file;
  return loc.excerpt !== undefined ? `${at} ${loc.excerpt}` : at;
}

function failureLine(failure: LoadAssistFailure, label: string): string {
  const loc = formatAssistLocation(failure);
  const err =
    failure.error !== undefined && failure.error.length > 0
      ? ` (${compactSqlExcerpt(failure.error)})`
      : "";
  return `  ${label} ${loc}${err}`;
}

function isSameFileMove(failure: LoadAssistFailure): boolean {
  return failure.after !== undefined && failure.after.file === failure.file;
}

export function formatReorderOnFailureMessage(
  kind: "file-kind" | "statement-kind",
  failures: readonly LoadAssistFailure[],
  suggestedLoadOrder?: readonly string[],
): string {
  const lines = [`Default load order stuck; reordered (${kind}).`];
  let anySameFile = false;
  let anyCrossFile = false;
  for (const failure of failures) {
    if (isSameFileMove(failure)) {
      anySameFile = true;
      lines.push(`  move ${formatAssistLocation(failure)}`);
      lines.push(`  after ${formatAssistLocation(failure.after!)}`);
    } else {
      lines.push(failureLine(failure, "stuck"));
      if (failure.after !== undefined) {
        anyCrossFile = true;
        lines.push(`  after ${formatAssistLocation(failure.after)}`);
      }
    }
  }
  if (anySameFile) {
    lines.push(
      "loadOrder cannot fix same-file order — edit or split the file.",
    );
  }
  if (anyCrossFile || !anySameFile) {
    if (suggestedLoadOrder !== undefined && suggestedLoadOrder.length > 0) {
      lines.push(
        `Set loadOrder on .pgdelta-export.json: ${suggestedLoadOrder.join(", ")}.`,
      );
    } else {
      const first = failures.find(
        (failure) =>
          failure.after !== undefined && failure.after.file !== failure.file,
      );
      if (first?.after?.file !== undefined) {
        lines.push(
          `Set loadOrder on .pgdelta-export.json to put ${first.after.file} before ${first.file}.`,
        );
      } else if (!anySameFile) {
        lines.push("Set loadOrder on .pgdelta-export.json.");
      }
    }
  }
  return lines.join("\n");
}

export function formatSessionPollutionMessage(
  failures: readonly LoadAssistFailure[],
  earlier: readonly LoadAssistLocation[] = [],
): string {
  const lines = ["New connection unblocked a stuck load (session poisoning)."];
  for (const failure of failures) {
    lines.push(failureLine(failure, "stuck"));
  }
  for (const loc of earlier) {
    lines.push(`  earlier ${formatAssistLocation(loc)}`);
  }
  lines.push(
    "Remove session-setting statements from declarative SQL, or do not share that session with later DDL.",
  );
  return lines.join("\n");
}

export function toLoadAssistContext(
  failures: readonly LoadAssistFailure[],
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    files: [...new Set(failures.map((failure) => failure.file))],
    failures: failures.map((failure) => ({
      file: failure.file,
      ...(failure.line !== undefined ? { line: failure.line } : {}),
      ...(failure.excerpt !== undefined ? { excerpt: failure.excerpt } : {}),
      ...(failure.error !== undefined ? { error: failure.error } : {}),
      ...(failure.after !== undefined ? { after: failure.after } : {}),
    })),
    ...extra,
  };
}

export function readLoadAssistFailures(value: unknown): LoadAssistFailure[] {
  if (!Array.isArray(value)) return [];
  const failures: LoadAssistFailure[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null || !("file" in item)) {
      continue;
    }
    if (typeof item.file !== "string") continue;
    const afterRaw =
      "after" in item && typeof item.after === "object" && item.after !== null
        ? item.after
        : undefined;
    const after =
      afterRaw !== undefined &&
      "file" in afterRaw &&
      typeof afterRaw.file === "string"
        ? {
            file: afterRaw.file,
            ...("line" in afterRaw && typeof afterRaw.line === "number"
              ? { line: afterRaw.line }
              : {}),
            ...("excerpt" in afterRaw && typeof afterRaw.excerpt === "string"
              ? { excerpt: afterRaw.excerpt }
              : {}),
          }
        : undefined;
    failures.push({
      file: item.file,
      ...("line" in item && typeof item.line === "number"
        ? { line: item.line }
        : {}),
      ...("excerpt" in item && typeof item.excerpt === "string"
        ? { excerpt: item.excerpt }
        : {}),
      ...("error" in item && typeof item.error === "string"
        ? { error: item.error }
        : {}),
      ...(after !== undefined ? { after } : {}),
    });
  }
  return failures;
}

export function readStringList(value: unknown): string[] | undefined {
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === "string")
  ) {
    return undefined;
  }
  return value;
}
