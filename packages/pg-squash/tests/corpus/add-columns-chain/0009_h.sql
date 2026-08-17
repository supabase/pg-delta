ALTER TABLE acc_t ADD CONSTRAINT acc_t_a_pos CHECK (a IS NULL OR a >= 0);
