-- state A: roles exist, no default privilege set on large objects
DO $$ BEGIN CREATE ROLE r_def_lo NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE owner_role_lo NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
