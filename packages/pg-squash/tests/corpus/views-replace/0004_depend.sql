CREATE VIEW vr_name_len AS
SELECT name, length(name) AS n FROM vr_names;
