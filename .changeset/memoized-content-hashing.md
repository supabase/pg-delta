---
"@supabase/pg-delta": patch
---

Speed up diffing and planning on very large catalogs by memoizing content hashing and trimming fact-base construction overhead.

Every fact-base REBUILD (managed-view reconstruction, baseline subtraction, scope/target projection, identity normalization) re-hashed every payload from scratch, so a single diff+plan on a million-object catalog spent most of its time computing the same few thousand SHA-256 digests millions of times. Content hashes are now memoized — by payload object (skipping canonical encoding entirely on a rebuild) and by canonical encoding (the real equality surface), with the string cache bounded so a long-lived process cannot accumulate. Fact-base construction also reuses the encoded parent key and pre-encoded edge endpoints instead of re-encoding stable ids on every hierarchy walk and rollup.

Digest output is unchanged — same hashes, same plans, same SQL. On a 433k-fact catalog: fact-base build 1.6s → 1.3s (0.7s for a rebuild), cold diff 1.36s → 0.98s, cold plan 3.7s → 2.7s, and peak heap roughly halved.
