-- Campaign configuration and consented, minimal attribution. No page contents or query strings.
CREATE TABLE widget_campaigns(project_id TEXT NOT NULL REFERENCES projects(id),id TEXT NOT NULL,revision INTEGER NOT NULL,config_json TEXT NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(project_id,id));
CREATE TABLE widget_campaign_visits(project_id TEXT NOT NULL REFERENCES projects(id),contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,visit_id TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(project_id,contact_id,visit_id));
CREATE TABLE widget_campaign_impressions(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,campaign_id TEXT NOT NULL,campaign_revision INTEGER NOT NULL,day TEXT NOT NULL,slot INTEGER NOT NULL,created_at INTEGER NOT NULL,shown_at INTEGER,opened_at INTEGER,dismissed_at INTEGER,conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,FOREIGN KEY(project_id,campaign_id) REFERENCES widget_campaigns(project_id,id),UNIQUE(project_id,contact_id,campaign_id,day,slot));
CREATE INDEX widget_campaign_report ON widget_campaign_impressions(project_id,created_at);
-- Revocation or native erasure of the consent subject removes identifiable campaign history.
CREATE TRIGGER widget_campaign_consent_revoked AFTER UPDATE OF consent ON context_subjects WHEN NEW.consent=0 BEGIN
 DELETE FROM widget_campaign_impressions WHERE project_id=NEW.project_id AND contact_id=NEW.subject_id;
 DELETE FROM widget_campaign_visits WHERE project_id=NEW.project_id AND contact_id=NEW.subject_id;
END;
CREATE TRIGGER widget_campaign_subject_erased AFTER DELETE ON context_subjects BEGIN
 DELETE FROM widget_campaign_impressions WHERE project_id=OLD.project_id AND contact_id=OLD.subject_id;
 DELETE FROM widget_campaign_visits WHERE project_id=OLD.project_id AND contact_id=OLD.subject_id;
END;

CREATE INDEX widget_campaign_impressions_expiry ON widget_campaign_impressions(created_at);
CREATE INDEX widget_campaign_visits_expiry ON widget_campaign_visits(created_at);
