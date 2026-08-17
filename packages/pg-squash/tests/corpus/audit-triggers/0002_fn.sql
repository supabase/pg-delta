CREATE FUNCTION aud_touch() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  INSERT INTO aud_log (item_id, op, label)
  VALUES (COALESCE(NEW.id, OLD.id), TG_OP, COALESCE(NEW.label, OLD.label));
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$fn$;
