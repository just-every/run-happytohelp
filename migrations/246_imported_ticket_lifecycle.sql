-- Import publication carries reviewed lifecycle categories. A final Closed
-- ticket must stay final; ordinary legacy/native writers retain their defaults.
DROP TRIGGER ticket_conversation_defaults;
CREATE TRIGGER ticket_conversation_defaults AFTER INSERT ON conversations BEGIN
 UPDATE conversations SET brand_id=NEW.project_id,requester_id=NEW.contact_id,submitter_id=COALESCE(NEW.submitter_id,NEW.contact_id),status_id= CASE WHEN EXISTS(SELECT 1 FROM move_in_native_fences f WHERE f.project_id=NEW.project_id AND f.conversation_id=NEW.id) THEN NEW.status_id WHEN NEW.resolved_at IS NOT NULL THEN 'solved' ELSE NEW.status_id END ,status_category= CASE WHEN EXISTS(SELECT 1 FROM move_in_native_fences f WHERE f.project_id=NEW.project_id AND f.conversation_id=NEW.id) THEN NEW.status_category WHEN NEW.resolved_at IS NOT NULL THEN 'solved' ELSE NEW.status_category END WHERE id=NEW.id;
END;
