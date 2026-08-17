INSERT INTO tg_t (id, tenant, created_at)
VALUES (1, current_setting('app.tenant', true), clock_timestamp());
