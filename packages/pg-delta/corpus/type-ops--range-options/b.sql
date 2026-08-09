CREATE SCHEMA app;

-- Non-default subtype operator class and an explicit multirange type name.
-- Both are drop+create options, so the forward diff must recreate each type;
-- before the options were extracted these hashed identically to the a-state.
CREATE TYPE app.textrange AS RANGE (subtype = text, subtype_opclass = text_pattern_ops);
CREATE TYPE app.numrange_custom AS RANGE (subtype = numeric, multirange_type_name = app.numrange_custom_mr);
