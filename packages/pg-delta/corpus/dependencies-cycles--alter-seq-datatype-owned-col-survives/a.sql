CREATE TABLE public.addons (
  addon_id integer NOT NULL,
  label text NOT NULL
);
CREATE SEQUENCE public.addons_addon_id_seq AS integer;
ALTER TABLE public.addons ALTER COLUMN addon_id SET DEFAULT nextval('public.addons_addon_id_seq'::regclass);
ALTER SEQUENCE public.addons_addon_id_seq OWNED BY public.addons.addon_id;
