CREATE SCHEMA app;

-- Default subtype opclass (text_ops) and auto-generated multirange name.
CREATE TYPE app.textrange AS RANGE (subtype = text);
CREATE TYPE app.numrange_custom AS RANGE (subtype = numeric);
