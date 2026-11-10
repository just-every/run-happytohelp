-- Repair for installations whose full legacy import ran before it removed its own trigger-written work rows
-- (hh-import-fidelity-1). Importing a company inserted contacts, conversations and articles, and the application's own
-- triggers answered each with a native_integration_events row (contact.created, conversation.status_changed,
-- article.published) and a workflow_events row, which the integration fan-out and the workflow scheduler then treat as
-- work. This removes exactly those rows and nothing else, decided by the import's own journal and never by pattern.
--
-- Provenance. legacy_import_rows says which contact, conversation and article each source row became, and
-- legacy_import_runs says when. A source row that became several rows names them in lists (conversations,conversation_ai), and
-- the first is the entity. Only a FULL import counts (a run with no delta or since marker: a delta batch already
-- removed its own trigger rows), and only once every run of its package is complete. A package's window is its first run
-- start to its last run completion. A row goes only when it names an imported entity AND carries a time inside that window:
-- a contact event is stamped with the wall clock of the write, so it must fall between first start and last completion, and
-- a conversation or article event is stamped with the entity's own updated_at (legacy time for the import's writes), so it
-- must not be later than the last completion. Whatever a member or a customer did afterwards is later than the import and
-- stays. An event that already fanned out (a native_integration_intents row names it) stays too, as does everything of a
-- package with an unfinished run. Nothing else is touched: no rule, no read mark, no resolution.
--
-- inbox_visitor_waiting: a conversation the import wrote whose only visitor authorship is the import's own
-- (source_kind legacy_import) is imported history, not a visitor waiting for the team. Its row is removed and the delete
-- trigger re-derives the inbox entry's flags. A conversation with a native visitor message keeps its row.
--
-- Idempotent: a second run finds nothing left to match. An installation that never imported has an empty scope and is untouched.
-- The scope table exists only while this migration runs.
DROP TABLE IF EXISTS legacy_repair_scope;
CREATE TABLE legacy_repair_scope(kind TEXT NOT NULL,id TEXT NOT NULL,first_at INTEGER NOT NULL,last_at INTEGER NOT NULL,PRIMARY KEY(kind,id)) WITHOUT ROWID;
INSERT INTO legacy_repair_scope(kind,id,first_at,last_at)
 SELECT substr(j.target_table,1,instr(j.target_table||',',',')-1) kind,substr(j.target_key,1,instr(j.target_key||',',',')-1) id,min(p.first_at),max(p.last_at)
 FROM legacy_import_rows j
 JOIN legacy_import_runs r ON r.id=j.run_id AND json_extract(r.source_json,'$.delta') IS NULL AND json_extract(r.source_json,'$.since') IS NULL
 JOIN (SELECT coalesce(json_extract(source_json,'$.package'),CASE WHEN id LIKE 'legacy-package:%' THEN substr(id,16) ELSE id END) package,min(created_at) first_at,max(completed_at) last_at
       FROM legacy_import_runs WHERE json_extract(source_json,'$.delta') IS NULL AND json_extract(source_json,'$.since') IS NULL
       GROUP BY 1 HAVING count(*)=count(completed_at) AND min(state='complete')=1) p
   ON p.package=coalesce(json_extract(r.source_json,'$.package'),CASE WHEN r.id LIKE 'legacy-package:%' THEN substr(r.id,16) ELSE r.id END)
 WHERE j.source_table IN ('contacts','conversations','articles','knowledge_articles') AND j.status='mapped' AND substr(j.target_table,1,instr(j.target_table||',',',')-1) IN ('contacts','conversations','knowledge_articles')
 GROUP BY 1,2;

DELETE FROM native_integration_events
 WHERE event IN ('contact.created','contact.updated')
  AND EXISTS(SELECT 1 FROM legacy_repair_scope s WHERE s.kind='contacts' AND s.id=native_integration_events.contact_id AND native_integration_events.created_at BETWEEN s.first_at AND s.last_at)
  AND NOT EXISTS(SELECT 1 FROM native_integration_intents i WHERE i.event_id=native_integration_events.id);
DELETE FROM native_integration_events
 WHERE conversation_id IS NOT NULL
  AND EXISTS(SELECT 1 FROM legacy_repair_scope s WHERE s.kind='conversations' AND s.id=native_integration_events.conversation_id AND native_integration_events.created_at<=s.last_at)
  AND NOT EXISTS(SELECT 1 FROM native_integration_intents i WHERE i.event_id=native_integration_events.id);
DELETE FROM native_integration_events
 WHERE event='article.published'
  AND EXISTS(SELECT 1 FROM legacy_repair_scope s WHERE s.kind='knowledge_articles' AND s.id=json_extract(native_integration_events.body,'$.article_id') AND native_integration_events.created_at<=s.last_at)
  AND NOT EXISTS(SELECT 1 FROM native_integration_intents i WHERE i.event_id=native_integration_events.id);
DELETE FROM workflow_events
 WHERE EXISTS(SELECT 1 FROM legacy_repair_scope s WHERE s.kind='conversations' AND s.id=workflow_events.conversation_id AND workflow_events.at<=s.last_at);
DELETE FROM inbox_visitor_waiting
 WHERE EXISTS(SELECT 1 FROM legacy_repair_scope s WHERE s.kind='conversations' AND s.id=inbox_visitor_waiting.conversation_id)
  AND EXISTS(SELECT 1 FROM messages m JOIN message_authorship a ON a.message_id=m.id WHERE m.conversation_id=inbox_visitor_waiting.conversation_id AND a.kind='visitor' AND a.source_kind='legacy_import')
  AND NOT EXISTS(SELECT 1 FROM messages m JOIN message_authorship a ON a.message_id=m.id WHERE m.conversation_id=inbox_visitor_waiting.conversation_id AND a.kind='visitor' AND a.source_kind IS NOT 'legacy_import');
DROP TABLE legacy_repair_scope;
