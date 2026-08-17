CREATE OR REPLACE VIEW vr_names AS
SELECT id, upper(name) AS name FROM vr_users;
