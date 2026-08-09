CREATE SCHEMA ecommerce;
DO $$ BEGIN CREATE ROLE corpus_ecommerce_admin LOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE corpus_ecommerce_user LOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE corpus_analytics_user LOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
