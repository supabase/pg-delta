CREATE DOMAIN dc_email AS text CHECK (value ~ '^[^@]+@[^@]+$');
