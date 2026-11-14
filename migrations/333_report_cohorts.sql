-- A date-indexed membership projection, not a snapshot of report figures. Empty
-- drafts never enter it. All evidence, permissions and dimensions remain live.
CREATE TABLE reporting_conversations(
 conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 status_category TEXT NOT NULL
);
CREATE INDEX reporting_conversations_created ON reporting_conversations(project_id,created_at,conversation_id);
CREATE INDEX reporting_conversations_active ON reporting_conversations(project_id,created_at,conversation_id) WHERE status_category NOT IN ('solved','closed');
CREATE INDEX reporting_brand_options ON conversations(project_id,brand_id);
INSERT INTO reporting_conversations(conversation_id,project_id,created_at,status_category)
 SELECT c.id,c.project_id,c.created_at,c.status_category FROM conversations c
 WHERE EXISTS(SELECT 1 FROM messages m WHERE m.project_id=c.project_id AND m.conversation_id=c.id);
CREATE TRIGGER reporting_message_insert AFTER INSERT ON messages BEGIN
 INSERT OR IGNORE INTO reporting_conversations(conversation_id,project_id,created_at,status_category)
 SELECT id,project_id,created_at,status_category FROM conversations WHERE id=NEW.conversation_id AND project_id=NEW.project_id;
END;
CREATE TRIGGER reporting_message_delete AFTER DELETE ON messages BEGIN
 DELETE FROM reporting_conversations WHERE conversation_id=OLD.conversation_id
 AND NOT EXISTS(SELECT 1 FROM messages m WHERE m.project_id=reporting_conversations.project_id AND m.conversation_id=reporting_conversations.conversation_id);
END;
CREATE TRIGGER reporting_message_move AFTER UPDATE OF conversation_id,project_id ON messages BEGIN
 DELETE FROM reporting_conversations WHERE conversation_id=OLD.conversation_id
 AND NOT EXISTS(SELECT 1 FROM messages m WHERE m.project_id=reporting_conversations.project_id AND m.conversation_id=reporting_conversations.conversation_id);
 INSERT OR IGNORE INTO reporting_conversations(conversation_id,project_id,created_at,status_category)
 SELECT id,project_id,created_at,status_category FROM conversations WHERE id=NEW.conversation_id AND project_id=NEW.project_id;
END;
CREATE TRIGGER reporting_conversation_update AFTER UPDATE OF project_id,created_at,status_category,assigned_to,group_id,brand_id,channel,contact_id ON conversations BEGIN
 DELETE FROM reporting_conversations WHERE conversation_id=OLD.id;
 INSERT INTO reporting_conversations(conversation_id,project_id,created_at,status_category)
 SELECT NEW.id,NEW.project_id,NEW.created_at,NEW.status_category
 WHERE EXISTS(SELECT 1 FROM messages m WHERE m.project_id=NEW.project_id AND m.conversation_id=NEW.id);
END;

-- Current workload dimensions and their historical presence inventory. Counts
-- still come only from the requested cohort plus the active backlog. The small
-- inventory retains zero buckets from older closed tickets without scanning them.
CREATE VIEW reporting_workload_source AS
 SELECT c.project_id,c.id conversation_id,d.value dimension,
 CASE WHEN d.value='tag' THEN COALESCE(ct.tag_id,'') ELSE '' END item_id,
 CASE d.value WHEN 'agent' THEN c.assigned_to WHEN 'team' THEN c.group_id WHEN 'channel' THEN c.channel WHEN 'brand' THEN COALESCE(c.brand_id,c.project_id) WHEN 'account' THEN a.id ELSE t.id END item_key,
 json_array(c.group_id,COALESCE(c.brand_id,c.project_id),CASE WHEN i.conversation_id IS NOT NULL OR l.conversation_id IS NOT NULL THEN 1 ELSE 0 END) scope_key,
 c.group_id team_id,COALESCE(c.brand_id,c.project_id) brand_id,
 CASE WHEN i.conversation_id IS NOT NULL OR l.conversation_id IS NOT NULL THEN 1 ELSE 0 END imported,
 c.created_at,c.status_category
 FROM reporting_conversations eligible JOIN conversations c ON c.id=eligible.conversation_id
 CROSS JOIN json_each('["agent","team","channel","brand","account","tag"]') d
 LEFT JOIN move_in_conversations i ON i.project_id=c.project_id AND i.conversation_id=c.id
 LEFT JOIN reporting_legacy_conversations l ON l.project_id=c.project_id AND l.conversation_id=c.id
 LEFT JOIN contact_companies cc ON d.value='account' AND cc.project_id=c.project_id AND cc.contact_id=c.contact_id
 LEFT JOIN companies a ON a.project_id=cc.project_id AND a.id=cc.company_id AND a.merged_into IS NULL
 LEFT JOIN conversation_tags ct ON d.value='tag' AND ct.project_id=c.project_id AND ct.conversation_id=c.id
 LEFT JOIN workspace_tags t ON t.project_id=ct.project_id AND t.id=ct.tag_id
 WHERE NOT EXISTS(SELECT 1 FROM conversation_merges merged WHERE merged.project_id=c.project_id AND merged.source_id=c.id AND merged.undone_at IS NULL);
CREATE TABLE reporting_workload_items(
 project_id TEXT NOT NULL,
 conversation_id TEXT NOT NULL REFERENCES reporting_conversations(conversation_id) ON DELETE CASCADE,
 dimension TEXT NOT NULL,item_id TEXT NOT NULL,item_key TEXT,scope_key TEXT NOT NULL,
 team_id TEXT,brand_id TEXT NOT NULL,imported INTEGER NOT NULL,created_at INTEGER NOT NULL,status_category TEXT NOT NULL,
 PRIMARY KEY(conversation_id,dimension,item_id)
);
CREATE INDEX reporting_workload_created ON reporting_workload_items(project_id,created_at);
CREATE INDEX reporting_workload_active ON reporting_workload_items(project_id,created_at) WHERE status_category NOT IN ('solved','closed');
CREATE INDEX reporting_workload_inventory ON reporting_workload_items(project_id,scope_key,dimension,item_key,created_at);
CREATE TABLE reporting_workload_keys(
 project_id TEXT NOT NULL,scope_key TEXT NOT NULL,key_id TEXT NOT NULL,
 dimension TEXT NOT NULL,item_key TEXT,team_id TEXT,brand_id TEXT NOT NULL,imported INTEGER NOT NULL,
 first_created_at INTEGER NOT NULL,items INTEGER NOT NULL,
 PRIMARY KEY(project_id,scope_key,key_id)
);
INSERT INTO reporting_workload_items(project_id,conversation_id,dimension,item_id,item_key,scope_key,team_id,brand_id,imported,created_at,status_category)
 SELECT project_id,conversation_id,dimension,item_id,item_key,scope_key,team_id,brand_id,imported,created_at,status_category FROM reporting_workload_source;
INSERT INTO reporting_workload_keys(project_id,scope_key,key_id,dimension,item_key,team_id,brand_id,imported,first_created_at,items)
 SELECT project_id,scope_key,json_array(dimension,item_key),dimension,item_key,team_id,brand_id,imported,MIN(created_at),COUNT(*)
 FROM reporting_workload_items GROUP BY project_id,scope_key,dimension,item_key;
CREATE TRIGGER reporting_workload_item_insert AFTER INSERT ON reporting_workload_items BEGIN
 INSERT INTO reporting_workload_keys(project_id,scope_key,key_id,dimension,item_key,team_id,brand_id,imported,first_created_at,items)
 VALUES(NEW.project_id,NEW.scope_key,json_array(NEW.dimension,NEW.item_key),NEW.dimension,NEW.item_key,NEW.team_id,NEW.brand_id,NEW.imported,NEW.created_at,1)
 ON CONFLICT(project_id,scope_key,key_id) DO UPDATE SET items=items+1,first_created_at=MIN(first_created_at,excluded.first_created_at);
END;
CREATE TRIGGER reporting_workload_item_delete AFTER DELETE ON reporting_workload_items BEGIN
 UPDATE reporting_workload_keys SET items=items-1,first_created_at=COALESCE((SELECT MIN(created_at) FROM reporting_workload_items WHERE project_id=OLD.project_id AND scope_key=OLD.scope_key AND dimension=OLD.dimension AND item_key IS OLD.item_key),first_created_at)
 WHERE project_id=OLD.project_id AND scope_key=OLD.scope_key AND key_id=json_array(OLD.dimension,OLD.item_key);
 DELETE FROM reporting_workload_keys WHERE project_id=OLD.project_id AND scope_key=OLD.scope_key AND key_id=json_array(OLD.dimension,OLD.item_key) AND items=0;
END;
CREATE TRIGGER reporting_workload_conversation_insert AFTER INSERT ON reporting_conversations BEGIN
 INSERT INTO reporting_workload_items(project_id,conversation_id,dimension,item_id,item_key,scope_key,team_id,brand_id,imported,created_at,status_category)
 SELECT project_id,conversation_id,dimension,item_id,item_key,scope_key,team_id,brand_id,imported,created_at,status_category FROM reporting_workload_source WHERE conversation_id=NEW.conversation_id;
END;
CREATE TRIGGER reporting_workload_conversation_tags_insert AFTER INSERT ON conversation_tags BEGIN
 DELETE FROM reporting_workload_items WHERE conversation_id IN (SELECT id FROM conversations WHERE (project_id=NEW.project_id AND id=NEW.conversation_id));
 INSERT INTO reporting_workload_items(project_id,conversation_id,dimension,item_id,item_key,scope_key,team_id,brand_id,imported,created_at,status_category)
 SELECT project_id,conversation_id,dimension,item_id,item_key,scope_key,team_id,brand_id,imported,created_at,status_category FROM reporting_workload_source WHERE conversation_id IN (SELECT id FROM conversations WHERE (project_id=NEW.project_id AND id=NEW.conversation_id));
END;
CREATE TRIGGER reporting_workload_conversation_tags_delete AFTER DELETE ON conversation_tags BEGIN
 DELETE FROM reporting_workload_items WHERE conversation_id IN (SELECT id FROM conversations WHERE (project_id=OLD.project_id AND id=OLD.conversation_id));
 INSERT INTO reporting_workload_items(project_id,conversation_id,dimension,item_id,item_key,scope_key,team_id,brand_id,imported,created_at,status_category)
 SELECT project_id,conversation_id,dimension,item_id,item_key,scope_key,team_id,brand_id,imported,created_at,status_category FROM reporting_workload_source WHERE conversation_id IN (SELECT id FROM conversations WHERE (project_id=OLD.project_id AND id=OLD.conversation_id));
END;
CREATE TRIGGER reporting_workload_conversation_tags_update AFTER UPDATE ON conversation_tags BEGIN
 DELETE FROM reporting_workload_items WHERE conversation_id IN (SELECT id FROM conversations WHERE (project_id=OLD.project_id AND id=OLD.conversation_id) OR (project_id=NEW.project_id AND id=NEW.conversation_id));
 INSERT INTO reporting_workload_items(project_id,conversation_id,dimension,item_id,item_key,scope_key,team_id,brand_id,imported,created_at,status_category)
 SELECT project_id,conversation_id,dimension,item_id,item_key,scope_key,team_id,brand_id,imported,created_at,status_category FROM reporting_workload_source WHERE conversation_id IN (SELECT id FROM conversations WHERE (project_id=OLD.project_id AND id=OLD.conversation_id) OR (project_id=NEW.project_id AND id=NEW.conversation_id));
END;
CREATE TRIGGER reporting_workload_contact_companies_insert AFTER INSERT ON contact_companies BEGIN
 DELETE FROM reporting_workload_items WHERE conversation_id IN (SELECT id FROM conversations WHERE (project_id=NEW.project_id AND contact_id=NEW.contact_id));
 INSERT INTO reporting_workload_items(project_id,conversation_id,dimension,item_id,item_key,scope_key,team_id,brand_id,imported,created_at,status_category)
 SELECT project_id,conversation_id,dimension,item_id,item_key,scope_key,team_id,brand_id,imported,created_at,status_category FROM reporting_workload_source WHERE conversation_id IN (SELECT id FROM conversations WHERE (project_id=NEW.project_id AND contact_id=NEW.contact_id));
END;
CREATE TRIGGER reporting_workload_contact_companies_delete AFTER DELETE ON contact_companies BEGIN
 DELETE FROM reporting_workload_items WHERE conversation_id IN (SELECT id FROM conversations WHERE (project_id=OLD.project_id AND contact_id=OLD.contact_id));
 INSERT INTO reporting_workload_items(project_id,conversation_id,dimension,item_id,item_key,scope_key,team_id,brand_id,imported,created_at,status_category)
 SELECT project_id,conversation_id,dimension,item_id,item_key,scope_key,team_id,brand_id,imported,created_at,status_category FROM reporting_workload_source WHERE conversation_id IN (SELECT id FROM conversations WHERE (project_id=OLD.project_id AND contact_id=OLD.contact_id));
END;
CREATE TRIGGER reporting_workload_contact_companies_update AFTER UPDATE ON contact_companies BEGIN
 DELETE FROM reporting_workload_items WHERE conversation_id IN (SELECT id FROM conversations WHERE (project_id=OLD.project_id AND contact_id=OLD.contact_id) OR (project_id=NEW.project_id AND contact_id=NEW.contact_id));
 INSERT INTO reporting_workload_items(project_id,conversation_id,dimension,item_id,item_key,scope_key,team_id,brand_id,imported,created_at,status_category)
 SELECT project_id,conversation_id,dimension,item_id,item_key,scope_key,team_id,brand_id,imported,created_at,status_category FROM reporting_workload_source WHERE conversation_id IN (SELECT id FROM conversations WHERE (project_id=OLD.project_id AND contact_id=OLD.contact_id) OR (project_id=NEW.project_id AND contact_id=NEW.contact_id));
END;
CREATE TRIGGER reporting_workload_move_in_conversations_insert AFTER INSERT ON move_in_conversations BEGIN
 DELETE FROM reporting_workload_items WHERE conversation_id IN (SELECT id FROM conversations WHERE (project_id=NEW.project_id AND id=NEW.conversation_id));
 INSERT INTO reporting_workload_items(project_id,conversation_id,dimension,item_id,item_key,scope_key,team_id,brand_id,imported,created_at,status_category)
 SELECT project_id,conversation_id,dimension,item_id,item_key,scope_key,team_id,brand_id,imported,created_at,status_category FROM reporting_workload_source WHERE conversation_id IN (SELECT id FROM conversations WHERE (project_id=NEW.project_id AND id=NEW.conversation_id));
END;
CREATE TRIGGER reporting_workload_move_in_conversations_delete AFTER DELETE ON move_in_conversations BEGIN
 DELETE FROM reporting_workload_items WHERE conversation_id IN (SELECT id FROM conversations WHERE (project_id=OLD.project_id AND id=OLD.conversation_id));
 INSERT INTO reporting_workload_items(project_id,conversation_id,dimension,item_id,item_key,scope_key,team_id,brand_id,imported,created_at,status_category)
 SELECT project_id,conversation_id,dimension,item_id,item_key,scope_key,team_id,brand_id,imported,created_at,status_category FROM reporting_workload_source WHERE conversation_id IN (SELECT id FROM conversations WHERE (project_id=OLD.project_id AND id=OLD.conversation_id));
END;
CREATE TRIGGER reporting_workload_move_in_conversations_update AFTER UPDATE ON move_in_conversations BEGIN
 DELETE FROM reporting_workload_items WHERE conversation_id IN (SELECT id FROM conversations WHERE (project_id=OLD.project_id AND id=OLD.conversation_id) OR (project_id=NEW.project_id AND id=NEW.conversation_id));
 INSERT INTO reporting_workload_items(project_id,conversation_id,dimension,item_id,item_key,scope_key,team_id,brand_id,imported,created_at,status_category)
 SELECT project_id,conversation_id,dimension,item_id,item_key,scope_key,team_id,brand_id,imported,created_at,status_category FROM reporting_workload_source WHERE conversation_id IN (SELECT id FROM conversations WHERE (project_id=OLD.project_id AND id=OLD.conversation_id) OR (project_id=NEW.project_id AND id=NEW.conversation_id));
END;
CREATE TRIGGER reporting_workload_reporting_legacy_conversations_insert AFTER INSERT ON reporting_legacy_conversations BEGIN
 DELETE FROM reporting_workload_items WHERE conversation_id IN (SELECT id FROM conversations WHERE (project_id=NEW.project_id AND id=NEW.conversation_id));
 INSERT INTO reporting_workload_items(project_id,conversation_id,dimension,item_id,item_key,scope_key,team_id,brand_id,imported,created_at,status_category)
 SELECT project_id,conversation_id,dimension,item_id,item_key,scope_key,team_id,brand_id,imported,created_at,status_category FROM reporting_workload_source WHERE conversation_id IN (SELECT id FROM conversations WHERE (project_id=NEW.project_id AND id=NEW.conversation_id));
END;
CREATE TRIGGER reporting_workload_reporting_legacy_conversations_delete AFTER DELETE ON reporting_legacy_conversations BEGIN
 DELETE FROM reporting_workload_items WHERE conversation_id IN (SELECT id FROM conversations WHERE (project_id=OLD.project_id AND id=OLD.conversation_id));
 INSERT INTO reporting_workload_items(project_id,conversation_id,dimension,item_id,item_key,scope_key,team_id,brand_id,imported,created_at,status_category)
 SELECT project_id,conversation_id,dimension,item_id,item_key,scope_key,team_id,brand_id,imported,created_at,status_category FROM reporting_workload_source WHERE conversation_id IN (SELECT id FROM conversations WHERE (project_id=OLD.project_id AND id=OLD.conversation_id));
END;
CREATE TRIGGER reporting_workload_reporting_legacy_conversations_update AFTER UPDATE ON reporting_legacy_conversations BEGIN
 DELETE FROM reporting_workload_items WHERE conversation_id IN (SELECT id FROM conversations WHERE (project_id=OLD.project_id AND id=OLD.conversation_id) OR (project_id=NEW.project_id AND id=NEW.conversation_id));
 INSERT INTO reporting_workload_items(project_id,conversation_id,dimension,item_id,item_key,scope_key,team_id,brand_id,imported,created_at,status_category)
 SELECT project_id,conversation_id,dimension,item_id,item_key,scope_key,team_id,brand_id,imported,created_at,status_category FROM reporting_workload_source WHERE conversation_id IN (SELECT id FROM conversations WHERE (project_id=OLD.project_id AND id=OLD.conversation_id) OR (project_id=NEW.project_id AND id=NEW.conversation_id));
END;
CREATE TRIGGER reporting_workload_conversation_merges_insert AFTER INSERT ON conversation_merges BEGIN
 DELETE FROM reporting_workload_items WHERE conversation_id IN (SELECT id FROM conversations WHERE (project_id=NEW.project_id AND id=NEW.source_id));
 INSERT INTO reporting_workload_items(project_id,conversation_id,dimension,item_id,item_key,scope_key,team_id,brand_id,imported,created_at,status_category)
 SELECT project_id,conversation_id,dimension,item_id,item_key,scope_key,team_id,brand_id,imported,created_at,status_category FROM reporting_workload_source WHERE conversation_id IN (SELECT id FROM conversations WHERE (project_id=NEW.project_id AND id=NEW.source_id));
END;
CREATE TRIGGER reporting_workload_conversation_merges_delete AFTER DELETE ON conversation_merges BEGIN
 DELETE FROM reporting_workload_items WHERE conversation_id IN (SELECT id FROM conversations WHERE (project_id=OLD.project_id AND id=OLD.source_id));
 INSERT INTO reporting_workload_items(project_id,conversation_id,dimension,item_id,item_key,scope_key,team_id,brand_id,imported,created_at,status_category)
 SELECT project_id,conversation_id,dimension,item_id,item_key,scope_key,team_id,brand_id,imported,created_at,status_category FROM reporting_workload_source WHERE conversation_id IN (SELECT id FROM conversations WHERE (project_id=OLD.project_id AND id=OLD.source_id));
END;
CREATE TRIGGER reporting_workload_conversation_merges_update AFTER UPDATE ON conversation_merges BEGIN
 DELETE FROM reporting_workload_items WHERE conversation_id IN (SELECT id FROM conversations WHERE (project_id=OLD.project_id AND id=OLD.source_id) OR (project_id=NEW.project_id AND id=NEW.source_id));
 INSERT INTO reporting_workload_items(project_id,conversation_id,dimension,item_id,item_key,scope_key,team_id,brand_id,imported,created_at,status_category)
 SELECT project_id,conversation_id,dimension,item_id,item_key,scope_key,team_id,brand_id,imported,created_at,status_category FROM reporting_workload_source WHERE conversation_id IN (SELECT id FROM conversations WHERE (project_id=OLD.project_id AND id=OLD.source_id) OR (project_id=NEW.project_id AND id=NEW.source_id));
END;
CREATE TRIGGER reporting_workload_company_update AFTER UPDATE OF merged_into ON companies BEGIN
 DELETE FROM reporting_workload_items WHERE conversation_id IN (SELECT id FROM conversations WHERE project_id=NEW.project_id AND contact_id IN (SELECT contact_id FROM contact_companies WHERE project_id=NEW.project_id AND company_id=NEW.id));
 INSERT INTO reporting_workload_items(project_id,conversation_id,dimension,item_id,item_key,scope_key,team_id,brand_id,imported,created_at,status_category)
 SELECT project_id,conversation_id,dimension,item_id,item_key,scope_key,team_id,brand_id,imported,created_at,status_category FROM reporting_workload_source WHERE conversation_id IN (SELECT id FROM conversations WHERE project_id=NEW.project_id AND contact_id IN (SELECT contact_id FROM contact_companies WHERE project_id=NEW.project_id AND company_id=NEW.id));
END;
