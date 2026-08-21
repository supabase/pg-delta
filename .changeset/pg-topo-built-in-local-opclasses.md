---
"@supabase/pg-topo": patch
---

Preserve local built-in-named range and operator family dependencies while recognizing additional PostgreSQL built-in support objects. This also handles OUT-parameter callback signatures, built-in numeric and array operator callbacks, GiST/SP-GiST distance operators, and built-in array signatures without matching explicitly public shadow types.
