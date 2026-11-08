-- Inbox search finds a contact by any substring of its name, email, provided name or provided email.
-- The view holds the four values exactly as the search compares them (SQLite's lower(), which folds
-- only A-Z); the trigram index over it answers a phrase of three or more characters as an exact
-- substring match, so a search reads the matching contacts instead of every conversation.
-- Like inbox_message_search it is derived: 'rebuild' restores it from contacts and
-- integrity-check with rank=1 validates it against them. secure-delete removes a changed or
-- erased identity's trigrams from storage rather than masking them.
CREATE VIEW inbox_contact_identity AS SELECT rowid AS rowid,lower(coalesce(name,'')) AS name,lower(coalesce(email,'')) AS email,lower(coalesce(iif(json_valid(metadata_json),json_extract(metadata_json,'$.provided_name'),NULL),'')) AS provided_name,lower(coalesce(iif(json_valid(metadata_json),json_extract(metadata_json,'$.provided_email'),NULL),'')) AS provided_email FROM contacts;
CREATE VIRTUAL TABLE inbox_contact_search USING fts5(name,email,provided_name,provided_email,content='inbox_contact_identity',content_rowid='rowid',tokenize='trigram case_sensitive 1');
INSERT INTO inbox_contact_search(inbox_contact_search,rank) VALUES('secure-delete',1);
INSERT INTO inbox_contact_search(inbox_contact_search) VALUES('rebuild');
CREATE TRIGGER inbox_contact_search_insert AFTER INSERT ON contacts BEGIN
 INSERT INTO inbox_contact_search(rowid,name,email,provided_name,provided_email) SELECT rowid,name,email,provided_name,provided_email FROM inbox_contact_identity WHERE rowid=new.rowid;
END;
CREATE TRIGGER inbox_contact_search_delete BEFORE DELETE ON contacts BEGIN
 INSERT INTO inbox_contact_search(inbox_contact_search,rowid,name,email,provided_name,provided_email) SELECT 'delete',rowid,name,email,provided_name,provided_email FROM inbox_contact_identity WHERE rowid=old.rowid;
END;
-- The widget rewrites metadata_json on every session; only a changed identity value reindexes.
CREATE TRIGGER inbox_contact_search_unindex BEFORE UPDATE OF name,email,metadata_json ON contacts WHEN old.name IS NOT new.name OR old.email IS NOT new.email OR iif(json_valid(old.metadata_json),json_extract(old.metadata_json,'$.provided_name'),NULL) IS NOT iif(json_valid(new.metadata_json),json_extract(new.metadata_json,'$.provided_name'),NULL) OR iif(json_valid(old.metadata_json),json_extract(old.metadata_json,'$.provided_email'),NULL) IS NOT iif(json_valid(new.metadata_json),json_extract(new.metadata_json,'$.provided_email'),NULL) BEGIN
 INSERT INTO inbox_contact_search(inbox_contact_search,rowid,name,email,provided_name,provided_email) SELECT 'delete',rowid,name,email,provided_name,provided_email FROM inbox_contact_identity WHERE rowid=old.rowid;
END;
CREATE TRIGGER inbox_contact_search_reindex AFTER UPDATE OF name,email,metadata_json ON contacts WHEN old.name IS NOT new.name OR old.email IS NOT new.email OR iif(json_valid(old.metadata_json),json_extract(old.metadata_json,'$.provided_name'),NULL) IS NOT iif(json_valid(new.metadata_json),json_extract(new.metadata_json,'$.provided_name'),NULL) OR iif(json_valid(old.metadata_json),json_extract(old.metadata_json,'$.provided_email'),NULL) IS NOT iif(json_valid(new.metadata_json),json_extract(new.metadata_json,'$.provided_email'),NULL) BEGIN
 INSERT INTO inbox_contact_search(rowid,name,email,provided_name,provided_email) SELECT rowid,name,email,provided_name,provided_email FROM inbox_contact_identity WHERE rowid=new.rowid;
END;
-- A #source or bare source id finds the imported conversation through its own key.
CREATE INDEX move_in_conversations_source ON move_in_conversations(source_id,project_id);
