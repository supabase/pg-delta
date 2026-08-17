CREATE FUNCTION sdf_peek(p_id int) RETURNS text
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $fn$ SELECT secret FROM sdf_hidden WHERE id = p_id $fn$;
