CREATE TABLE public.labs (
  id bigint PRIMARY KEY,
  lab_id bigint NOT NULL,
  CONSTRAINT unique_lab_id UNIQUE (lab_id)
);
CREATE TABLE public.posts (
  id bigint PRIMARY KEY,
  lab_id bigint NOT NULL,
  CONSTRAINT posts_lab_id_fkey FOREIGN KEY (lab_id) REFERENCES public.labs(lab_id)
);
CREATE TABLE public.post_attachments (
  id bigint PRIMARY KEY,
  post_id bigint NOT NULL,
  CONSTRAINT post_attachments_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id)
);
CREATE PUBLICATION supabase_realtime
  FOR TABLE public.labs, public.posts, public.post_attachments;
