import type {
  LedgerDiff,
  RoleMembership,
  RoleSetting,
} from "../shadow/index.ts";

export type TableCoverage = "fingerprint" | "count" | "none";

export type TableProofInput = {
  schema: string;
  name: string;
  rows: number;
  schemaSig: string;
  content?: string;
  /** Per-column fingerprints. Used when the whole-row digest is volatile. */
  columnContent?: Record<string, string>;
};

export type TableProof = {
  schema: string;
  name: string;
  coverage: TableCoverage;
  originalRows: number;
  candidateRows: number;
  originalContent?: string;
  candidateContent?: string;
};

export type CapturedState = {
  rootHash: string;
  ledger: LedgerDiff;
  tables: TableProofInput[];
};

export type EquivalenceProof = {
  equal: boolean;
  originalRootHash: string;
  candidateRootHash: string;
  ledgerEqual: boolean;
  tables: TableProof[];
};

const relKey = (schema: string, name: string): string =>
  JSON.stringify([schema, name]);

const membershipCanon = (m: RoleMembership): string =>
  `${m.role}\0${m.member}\0${m.adminOption ? "1" : "0"}`;

const settingCanon = (s: RoleSetting): string =>
  `${s.database ?? ""}\0${s.role}\0${[...s.setconfig].sort().join("\n")}`;

const canonLedger = (ledger: LedgerDiff): string =>
  JSON.stringify({
    createdRoles: [...ledger.createdRoles].sort(),
    droppedRoles: [...ledger.droppedRoles].sort(),
    addedMemberships: [...ledger.addedMemberships].map(membershipCanon).sort(),
    removedMemberships: [...ledger.removedMemberships]
      .map(membershipCanon)
      .sort(),
    addedSettings: [...ledger.addedSettings].map(settingCanon).sort(),
    removedSettings: [...ledger.removedSettings].map(settingCanon).sort(),
  });

const compareTable = (
  original: TableProofInput | undefined,
  candidate: TableProofInput | undefined,
  schema: string,
  name: string,
): { proof: TableProof; ok: boolean } => {
  if (original === undefined || candidate === undefined) {
    return {
      proof: {
        schema,
        name,
        coverage: "none",
        originalRows: original?.rows ?? 0,
        candidateRows: candidate?.rows ?? 0,
        ...(original?.content !== undefined
          ? { originalContent: original.content }
          : {}),
        ...(candidate?.content !== undefined
          ? { candidateContent: candidate.content }
          : {}),
      },
      ok: false,
    };
  }
  if (original.rows === 0 && candidate.rows === 0) {
    return {
      proof: {
        schema,
        name,
        coverage: "none",
        originalRows: 0,
        candidateRows: 0,
      },
      ok: true,
    };
  }
  const origCols = original.columnContent;
  if (
    origCols !== undefined &&
    original.rows > 0 &&
    candidate.rows > 0 &&
    original.schemaSig === candidate.schemaSig
  ) {
    const colKeys = Object.keys(origCols).sort((a, b) => a.localeCompare(b));
    if (colKeys.length > 0) {
      const candCols = candidate.columnContent;
      const originalContent = JSON.stringify(
        Object.fromEntries(colKeys.map((k) => [k, origCols[k]])),
      );
      const candidateContent = JSON.stringify(
        Object.fromEntries(colKeys.map((k) => [k, candCols?.[k]])),
      );
      return {
        proof: {
          schema,
          name,
          coverage: "fingerprint",
          originalRows: original.rows,
          candidateRows: candidate.rows,
          originalContent,
          candidateContent,
        },
        ok: originalContent === candidateContent,
      };
    }
  }
  const canFingerprint =
    original.rows > 0 &&
    candidate.rows > 0 &&
    original.schemaSig === candidate.schemaSig &&
    original.content !== undefined &&
    candidate.content !== undefined;
  if (canFingerprint) {
    return {
      proof: {
        schema,
        name,
        coverage: "fingerprint",
        originalRows: original.rows,
        candidateRows: candidate.rows,
        originalContent: original.content,
        candidateContent: candidate.content,
      },
      ok: original.content === candidate.content,
    };
  }
  return {
    proof: {
      schema,
      name,
      coverage: "count",
      originalRows: original.rows,
      candidateRows: candidate.rows,
      ...(original.content !== undefined
        ? { originalContent: original.content }
        : {}),
      ...(candidate.content !== undefined
        ? { candidateContent: candidate.content }
        : {}),
    },
    ok: original.rows === candidate.rows,
  };
};

/** Pure comparison. v1 volatility mask is applied by the caller, if at all. */
export const compareProofStates = (
  original: CapturedState,
  candidate: CapturedState,
): EquivalenceProof => {
  const ledgerEqual =
    canonLedger(original.ledger) === canonLedger(candidate.ledger);
  const originalTables = new Map(
    original.tables.map((t) => [relKey(t.schema, t.name), t]),
  );
  const candidateTables = new Map(
    candidate.tables.map((t) => [relKey(t.schema, t.name), t]),
  );
  const keys = [
    ...new Set([...originalTables.keys(), ...candidateTables.keys()]),
  ].sort();
  const tables: TableProof[] = [];
  let tablesOk = true;
  for (const key of keys) {
    const orig = originalTables.get(key);
    const cand = candidateTables.get(key);
    const schema = orig?.schema ?? cand?.schema ?? "";
    const name = orig?.name ?? cand?.name ?? "";
    const { proof, ok } = compareTable(orig, cand, schema, name);
    tables.push(proof);
    if (!ok) tablesOk = false;
  }
  const hashEqual = original.rootHash === candidate.rootHash;
  return {
    equal: hashEqual && ledgerEqual && tablesOk,
    originalRootHash: original.rootHash,
    candidateRootHash: candidate.rootHash,
    ledgerEqual,
    tables,
  };
};
