CREATE FUNCTION blog.comment_count(pid int) RETURNS int
LANGUAGE sql STABLE AS $fn$
  SELECT count(*)::int FROM blog.comments WHERE post_id = pid
$fn$;
