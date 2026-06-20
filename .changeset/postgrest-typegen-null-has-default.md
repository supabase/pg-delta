---
"@supabase/postgrest-typegen": patch
---

Accept `null` `has_default` for OUT/TABLE function args in `parseGeneratorMetadata`. The introspection SQL sizes `arg_has_defaults` from the input-arg count (`pronargs`) while `arg_modes`/`arg_types` include output args, so `introspect()` legitimately emits `has_default: null` for the OUT columns of RETURNS TABLE / OUT-arg functions. The opt-in validator previously typed this field as a plain `boolean` and rejected such valid introspector output. The field is now `boolean | null`; generator output is unaffected (the generators already treat `has_default` truthily, so `null` and `false` behave identically).
