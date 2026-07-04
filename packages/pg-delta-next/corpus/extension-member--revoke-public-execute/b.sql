CREATE EXTENSION hstore SCHEMA public;

-- Revoke an extension member's INSTALL-TIME PUBLIC EXECUTE (acldefault gives it
-- to every function). This is a customization BELOW the as-installed state; the
-- init-privs delta must emit an empty-privileges marker so the diff plans a
-- REVOKE (forward) and restores the install grant (reverse). No roles → shared
-- cluster. NB: the corpus proof loop cannot catch a regression here — extraction
-- is symmetrically blind to a lost member REVOKE — so plan shape is pinned in
-- tests/extension-member-acl.test.ts; this scenario guards end-to-end convergence.
REVOKE EXECUTE ON FUNCTION hstore(text, text) FROM PUBLIC;
