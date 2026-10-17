-- Merge is an operator view over intact source records, never an identity merge.
CREATE TABLE conversation_merges(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),source_id TEXT NOT NULL REFERENCES conversations(id),target_id TEXT NOT NULL REFERENCES conversations(id),actor_id TEXT NOT NULL,created_at INTEGER NOT NULL,source_version INTEGER NOT NULL,target_version INTEGER NOT NULL,source_revision INTEGER NOT NULL,target_revision INTEGER NOT NULL,undone_at INTEGER,undone_by TEXT,CHECK(source_id<>target_id));
CREATE UNIQUE INDEX conversation_merge_source ON conversation_merges(project_id,source_id) WHERE undone_at IS NULL;
CREATE INDEX conversation_merge_target ON conversation_merges(project_id,target_id,undone_at);
CREATE TABLE partner_forwards(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),conversation_id TEXT NOT NULL REFERENCES conversations(id),actor_id TEXT NOT NULL,command_key TEXT NOT NULL,intent_hash TEXT NOT NULL,recipient TEXT NOT NULL,subject TEXT NOT NULL,content TEXT NOT NULL,message_ids_json TEXT NOT NULL,grant_hash TEXT NOT NULL UNIQUE,created_at INTEGER NOT NULL,revoked_at INTEGER,state TEXT NOT NULL DEFAULT 'prepared',UNIQUE(project_id,conversation_id,actor_id,command_key));
CREATE TABLE partner_replies(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),conversation_id TEXT NOT NULL REFERENCES conversations(id),forward_id TEXT NOT NULL REFERENCES partner_forwards(id),receipt_id TEXT NOT NULL UNIQUE,local_id TEXT NOT NULL,intent_hash TEXT NOT NULL,content TEXT NOT NULL,created_at INTEGER NOT NULL,UNIQUE(project_id,conversation_id,local_id));
CREATE TABLE partner_reply_files(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),conversation_id TEXT NOT NULL REFERENCES conversations(id),reply_id TEXT NOT NULL REFERENCES partner_replies(id),object_key TEXT NOT NULL UNIQUE,filename TEXT NOT NULL,content_type TEXT NOT NULL,size INTEGER NOT NULL,created_at INTEGER NOT NULL);
CREATE INDEX partner_forwards_thread ON partner_forwards(project_id,conversation_id,created_at);
CREATE INDEX partner_replies_thread ON partner_replies(project_id,conversation_id,created_at);
-- Journals and private replies audit only ids and counts; never addresses or text.
CREATE TRIGGER conversation_merge_audit AFTER INSERT ON conversation_merges BEGIN
 INSERT INTO audit_events(id,project_id,at,category,action,outcome,actor_type,actor_id,source,target_type,target_id,detail_json) VALUES('merge:'||NEW.id,NEW.project_id,NEW.created_at,'data','conversation.merged','succeeded','user',NEW.actor_id,'dashboard','conversation',NEW.target_id,json_object('merge_id',NEW.id,'source_id',NEW.source_id));
END;
CREATE TRIGGER conversation_unmerge_audit AFTER UPDATE OF undone_at ON conversation_merges WHEN OLD.undone_at IS NULL AND NEW.undone_at IS NOT NULL BEGIN
 INSERT INTO audit_events(id,project_id,at,category,action,outcome,actor_type,actor_id,source,target_type,target_id,detail_json) VALUES('unmerge:'||NEW.id,NEW.project_id,NEW.undone_at,'data','conversation.merge_undone','succeeded','user',NEW.undone_by,'dashboard','conversation',NEW.target_id,json_object('merge_id',NEW.id,'source_id',NEW.source_id));
END;
CREATE TRIGGER partner_forward_audit AFTER INSERT ON partner_forwards BEGIN
 INSERT INTO audit_events(id,project_id,at,category,action,outcome,actor_type,actor_id,source,target_type,target_id,detail_json) VALUES('partner:'||NEW.id,NEW.project_id,NEW.created_at,'data','conversation.partner_forward','succeeded','user',NEW.actor_id,'dashboard','conversation',NEW.conversation_id,json_object('forward_id',NEW.id,'messages',json_array_length(NEW.message_ids_json)));
END;
CREATE TRIGGER partner_reply_audit AFTER INSERT ON partner_replies BEGIN
 INSERT INTO audit_events(id,project_id,at,category,action,outcome,actor_type,actor_id,source,target_type,target_id,detail_json) VALUES('partner-reply:'||NEW.id,NEW.project_id,NEW.created_at,'data','conversation.partner_reply','succeeded','system',NULL,'email','conversation',NEW.conversation_id,json_object('forward_id',NEW.forward_id,'reply_id',NEW.id));
END;
