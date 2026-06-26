---
"@supabase/pg-delta-next": minor
---

Add the opt-in statement-reordering assist for shadow loading, exposed at the new `@supabase/pg-delta-next/sql-order` subpath. `orderForShadow(files)` splits SQL files into one-statement units and topologically pre-sorts them (via `@supabase/pg-topo`) into single-statement `SqlFile`s with zero-padded ordinal name prefixes, so the existing parser-free shadow loader becomes statement-granular with no core change and converges regardless of intra-file authoring order. Every input statement is preserved exactly once (including unclassifiable statements and cycle members), with provenance carried back to the source file. `@supabase/pg-topo` is an optional peer dependency, loaded only when this subpath runs — importing the core never pulls the WASM parser. `canReorder()` probes availability; `ReorderUnavailableError` (with an install hint) is thrown when the peer is absent. No CLI wiring yet.
