CREATE TABLE public.addons (
  addon_id integer NOT NULL,
  label text NOT NULL
);
CREATE SEQUENCE public.addons_addon_id_seq;
ALTER TABLE public.addons ALTER COLUMN addon_id SET DEFAULT nextval('public.addons_addon_id_seq'::regclass);
