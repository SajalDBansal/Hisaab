-- Live notices: membership and session changes announce themselves on the
-- hisaab_live channel, whichever code path made them (team screen, ownership
-- hand-over, Better Auth logout or device takeover, account deletion).
-- PostgreSQL delivers NOTIFY only when the transaction commits.
CREATE OR REPLACE FUNCTION notify_live_access()
RETURNS trigger AS $$
DECLARE
  row_data record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    row_data := OLD;
  ELSE
    row_data := NEW;
  END IF;
  PERFORM pg_notify(
    'hisaab_live',
    json_build_object('t', 'access', 'f', row_data.organization_id, 'u', row_data.user_id)::text
  );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER member_live_access
AFTER INSERT OR DELETE OR UPDATE OF role ON "member"
FOR EACH ROW EXECUTE FUNCTION notify_live_access();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION notify_live_session_end()
RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify(
    'hisaab_live',
    json_build_object('t', 'session', 'u', OLD.user_id, 's', OLD.id)::text
  );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER session_live_end
AFTER DELETE ON "session"
FOR EACH ROW EXECUTE FUNCTION notify_live_session_end();
