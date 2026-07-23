CREATE TABLE public.storage_modes (payload text);

ALTER TABLE public.storage_modes ALTER COLUMN payload SET STORAGE EXTERNAL;
