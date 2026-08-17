ALTER TABLE expc_users ALTER COLUMN email_norm SET NOT NULL;
ALTER TABLE expc_users ADD CONSTRAINT expc_users_email_norm_key UNIQUE (email_norm);
