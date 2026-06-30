---
"@supabase/pg-delta-next": patch
---

Fix more `schema export --format-options` cases that produced invalid SQL:

- **Quoted object names dropped the following clause.** The catalog renderer double-quotes object names, but the formatter's tokenizer skips quoted identifiers, so positional token indexing landed past the name onto the first clause keyword. A trigger lost its `… ON <table>` event clause, a foreign server lost `DATA WRAPPER <fdw>`, a subscription lost its `CONNECTION` conninfo (and the foreign-data-wrapper / language forms had the same latent bug). Each now locates the name from the raw statement (quote-aware) before slicing clauses.
- **Keyword-like qualified type names were split.** A schema-qualified user type whose final component is a non-reserved keyword — e.g. a function `RETURNS public.cost` or a column of type `public.generated` — was mistaken for the `COST` / `GENERATED` clause/boundary keyword and split into invalid SQL. A keyword that is the tail of a qualified name (preceded by `.`) is now treated as an identifier.
