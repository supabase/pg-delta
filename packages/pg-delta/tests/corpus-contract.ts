/**
 * Base class for corpus harness contract failures. EXPECTED_RED may classify an
 * ordinary planner/proof failure as pinned, but must never swallow a failure in
 * the harness's own coverage or semantic-assertion contracts.
 */
export class CorpusContractError extends Error {}
