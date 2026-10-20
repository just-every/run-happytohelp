import {DatabaseSync} from 'node:sqlite';

// Prior schema definitions a migration deliberately replaces. 0110 adds only the
// native import fence to the two context message triggers' bodies.
export const schemaExceptions = [
  {migration: '0105_edition_delegation.sql', names: ['knowledge_articles'], change: 'Adds source_revision and source_incarnation; original columns retained'},
  {migration: '0108_public_answer_citations.sql', names: ['knowledge_articles', 'messages'], change: 'Adds generated publication_version and citations_json; original definitions retained'},
  {migration: '122_email_content.sql', names: ['messages'], change: 'Adds nullable content_raw TEXT'},
  {migration: '120_activation_observations.sql', names: ['activation_receipts'], change: 'Adds nullable observation_json TEXT; every prior column definition is retained'},
  {migration: '121_move_in_categories.sql', names: ['edition_category_insert', 'edition_category_delete'], change: 'Removes insertion invalidation and limits deletion invalidation to affected article ancestry'},
  {migration: '130_ticket_model.sql', names: ['conversations'], change: 'Adds only the fourteen ticket columns; every prior column definition is retained'},
  {migration: '146_participant_provenance.sql', names: ['conversation_participants'], change: "Adds joined_via TEXT NOT NULL DEFAULT 'cc_header' CHECK(joined_via IN ('cc_header','operator','self')); every prior column definition is retained"},
  {migration: '160_mailboxes.sql', names: ['conversations'], change: 'Adds nullable mailbox_id TEXT; all existing ticket columns retained'},
  {migration: '132_ticket_erasure.sql', names: ['contact_erasures'], change: 'Adds ticket_records INTEGER NOT NULL DEFAULT 0'},
  {migration: '170_knowledge_experience.sql', names: ['knowledge_categories', 'knowledge_articles'], change: 'Adds audience, allowed_domains and editor_id; prior definitions retained'},
  {migration: '181_context_message_subjects.sql', names: ['context_message_added'], change: 'Replaces the OR lookup with the keyed UNION for the same two subjects; retains the import fence'},
  {migration: '182_import_kit_reversal_retirement.sql', names: ['ik_d1_stream_revision_update'], change: 'Allows namespace/operation retirement only for a deleted stream with its recorded retirement'},
  {migration: '190_email_step_up.sql', names: ['session_factors'], change: 'Rebuilds only the proof-method CHECK to admit email_link; all four prior columns and rows retained'},
  {migration: '195_restore_trigger_boundaries.sql', names: ['conversation_record_resolution'], change: 'Adds only whitespace before CASE and between END and its comma so the pinned Wrangler SQL splitter retains statement boundaries'},
  {migration: '211_move_in_delta_fences.sql', names: ['ticket_version_update', 'ticket_closed_terminal', 'ticket_history_update', 'ticket_conversation_defaults'], change: 'Adds the reviewed import fence to version, terminal-status and history triggers; API imports retain their explicit status in the insert defaults'},
  {migration: '0110_move_in.sql', names: ['context_message_added', 'context_message_removed'], change: 'WHEN NOT EXISTS(SELECT 1 FROM move_in_native_fences ...) inserted before BEGIN'},
];

// Every prior table, index, trigger and view keeps its exact definition, except
// the listed replacements, which must match their documented change exactly.
export function expectedSchema(before, after, added) {
  const changed = [];
  for (const [name, entry] of Object.entries(before)) {
    const fence = added.includes('0110_move_in.sql') && {context_message_added: 'NEW', context_message_removed: 'OLD'}[name];
    let wanted = fence ? {...entry, sql: entry.sql.replace(' BEGIN ', ` WHEN NOT EXISTS(SELECT 1 FROM move_in_native_fences f WHERE f.project_id=${fence}.project_id AND f.conversation_id=${fence}.conversation_id) BEGIN `)} : entry;
    if (entry.type === 'table') {
      const alters = tableChanges.filter(change => added.includes(change.migration) && change.table === name);
      if (alters.length) {
        const db = new DatabaseSync(':memory:');
        try {
          db.exec(entry.sql);
          for (const change of alters) db.exec(change.sql);
          wanted = {...entry, sql: db.prepare("SELECT sql FROM sqlite_master WHERE name=?").get(name).sql};
        } finally { db.close(); }
      }
    }
    if (added.includes('195_restore_trigger_boundaries.sql') && name === 'conversation_record_resolution') wanted = {...entry, sql: entry.sql.replace(/\bEND,/g, 'END ,').replace('first_resolved_at=CASE', 'first_resolved_at= CASE')};
    if (added.includes('211_move_in_delta_fences.sql')) {
      const importFence = 'NOT EXISTS(SELECT 1 FROM move_in_native_fences f WHERE f.project_id=NEW.project_id AND f.conversation_id=NEW.id)';
      if (name === 'ticket_version_update') wanted = {...entry, sql: entry.sql.replace(' BEGIN ', ` WHEN ${importFence} BEGIN `)};
      if (name === 'ticket_closed_terminal' || name === 'ticket_history_update') wanted = {...entry, sql: entry.sql.replace(' WHEN ', ` WHEN ${importFence} AND (`).replace(' BEGIN', ') BEGIN')};
      if (name === 'ticket_conversation_defaults') wanted = {...entry, sql: entry.sql
        .replace('status_id= CASE WHEN NEW.resolved_at', "status_id= CASE WHEN NEW.ticket_source='move-in-api' THEN NEW.status_id WHEN NEW.resolved_at")
        .replace('status_category= CASE WHEN NEW.resolved_at', "status_category= CASE WHEN NEW.ticket_source='move-in-api' THEN NEW.status_category WHEN NEW.resolved_at")};
    }
    if (added.includes('181_context_message_subjects.sql') && name === 'context_message_added') wanted = {...entry, sql: messageSubjectTrigger};
    if (added.includes('182_import_kit_reversal_retirement.sql') && name === 'ik_d1_stream_revision_update') wanted = {...entry, sql: streamRetirementTrigger};
    if (added.includes('121_move_in_categories.sql')) {
      if (name === 'edition_category_insert') {
        if (after[name] !== undefined) changed.push(name);
        continue;
      }
      if (name === 'edition_category_delete') wanted = {...entry, sql: categoryDelete};
    }
    if (JSON.stringify(after[name]) !== JSON.stringify(wanted)) changed.push(name);
  }
  return changed;
}

// The deliberate replacement's full expected body: unrelated article revisions
// must not be invalidated, including articles linked through the join table.
const categoryDelete = `CREATE TRIGGER edition_category_delete BEFORE DELETE ON knowledge_categories BEGIN
 UPDATE knowledge_articles SET source_revision=source_revision+1
 WHERE project_id=OLD.project_id AND (
  category_id IN (WITH RECURSIVE descendants(id) AS (SELECT OLD.id UNION SELECT c.id FROM knowledge_categories c JOIN descendants d ON c.parent_id=d.id WHERE c.project_id=OLD.project_id) SELECT id FROM descendants)
  OR id IN (SELECT article_id FROM knowledge_article_categories WHERE category_id IN (WITH RECURSIVE descendants(id) AS (SELECT OLD.id UNION SELECT c.id FROM knowledge_categories c JOIN descendants d ON c.parent_id=d.id WHERE c.project_id=OLD.project_id) SELECT id FROM descendants))
 );
END`;

// Expected additions/replacements are explicit, independent of the migration
// files under test. Let SQLite serialize ALTER/RENAME without ignoring schema.
const tableChanges = [
  {migration: '0105_edition_delegation.sql', table: 'knowledge_articles', sql: "ALTER TABLE knowledge_articles ADD COLUMN source_revision INTEGER NOT NULL DEFAULT 1; ALTER TABLE knowledge_articles ADD COLUMN source_incarnation TEXT NOT NULL DEFAULT ''"},
  {migration: '0108_public_answer_citations.sql', table: 'knowledge_articles', sql: "ALTER TABLE knowledge_articles ADD COLUMN publication_version TEXT GENERATED ALWAYS AS (source_incarnation || ':' || source_revision) VIRTUAL"},
  {migration: '0108_public_answer_citations.sql', table: 'messages', sql: "ALTER TABLE messages ADD COLUMN citations_json TEXT NOT NULL DEFAULT '[]'"},
  {migration: '122_email_content.sql', table: 'messages', sql: 'ALTER TABLE messages ADD COLUMN content_raw TEXT'},
  {migration: '120_activation_observations.sql', table: 'activation_receipts', sql: 'ALTER TABLE activation_receipts ADD COLUMN observation_json TEXT'},
  {migration: '130_ticket_model.sql', table: 'conversations', sql: [
    "status_id TEXT NOT NULL DEFAULT 'new'",
    "status_category TEXT NOT NULL DEFAULT 'new' CHECK(status_category IN ('new','open','pending','on_hold','solved','closed'))",
    "subject TEXT NOT NULL DEFAULT ''",
    "priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high','urgent'))",
    "channel TEXT NOT NULL DEFAULT 'widget'", 'brand_id TEXT', 'group_id TEXT', 'requester_id TEXT', 'submitter_id TEXT',
    "submitter_type TEXT NOT NULL DEFAULT 'contact'", 'ticket_version INTEGER NOT NULL DEFAULT 0', 'ticket_actor_id TEXT',
    "ticket_actor_type TEXT NOT NULL DEFAULT 'system'", "ticket_source TEXT NOT NULL DEFAULT 'system'",
  ].map(column => `ALTER TABLE conversations ADD COLUMN ${column};`).join('\n')},
  {migration: '146_participant_provenance.sql', table: 'conversation_participants', sql: "ALTER TABLE conversation_participants ADD COLUMN joined_via TEXT NOT NULL DEFAULT 'cc_header' CHECK(joined_via IN ('cc_header','operator','self'));"},
  {migration: '160_mailboxes.sql', table: 'conversations', sql: 'ALTER TABLE conversations ADD COLUMN mailbox_id TEXT'},
  {migration: '132_ticket_erasure.sql', table: 'contact_erasures', sql: 'ALTER TABLE contact_erasures ADD COLUMN ticket_records INTEGER NOT NULL DEFAULT 0'},
  {migration: '170_knowledge_experience.sql', table: 'knowledge_categories', sql: `ALTER TABLE knowledge_categories ADD COLUMN audience TEXT NOT NULL DEFAULT 'public' CHECK(audience IN ('public','signed-in','domains')); ALTER TABLE knowledge_categories ADD COLUMN allowed_domains TEXT NOT NULL DEFAULT '[]'`},
  {migration: '170_knowledge_experience.sql', table: 'knowledge_articles', sql: 'ALTER TABLE knowledge_articles ADD COLUMN editor_id TEXT'},
  {migration: '190_email_step_up.sql', table: 'session_factors', sql: `CREATE TABLE session_factors_email(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,method TEXT NOT NULL CHECK(method IN ('password','email_link','totp','webauthn','recovery','installation')),verified_at INTEGER NOT NULL); DROP TABLE session_factors; ALTER TABLE session_factors_email RENAME TO session_factors`},
];
const messageSubjectTrigger = 'CREATE TRIGGER context_message_added AFTER INSERT ON messages WHEN NOT EXISTS(SELECT 1 FROM move_in_native_fences f WHERE f.project_id=NEW.project_id AND f.conversation_id=NEW.conversation_id) BEGIN UPDATE context_subjects SET revision=revision+1 WHERE project_id=NEW.project_id AND subject_id IN (SELECT contact_id FROM conversations WHERE id=NEW.conversation_id AND project_id=NEW.project_id UNION SELECT NEW.actor_id); END';
const streamRetirementTrigger = "CREATE TRIGGER ik_d1_stream_revision_update BEFORE UPDATE ON ik_d1_stream_revisions WHEN NEW.stream_id IS NOT OLD.stream_id OR NEW.destination IS NOT OLD.destination OR NEW.mapping_version IS NOT OLD.mapping_version OR NEW.principal_id IS NOT OLD.principal_id OR NEW.fingerprint IS NOT OLD.fingerprint OR NEW.total IS NOT OLD.total OR NEW.layout_hash IS NOT OLD.layout_hash OR NEW.layout_revision<OLD.layout_revision OR NEW.progress_revision<=OLD.progress_revision OR ((NEW.namespace IS NOT OLD.namespace OR NEW.operation_key IS NOT OLD.operation_key) AND NOT (NEW.namespace='' AND NEW.operation_key='' AND NOT EXISTS(SELECT 1 FROM ik_d1_streams WHERE id=OLD.stream_id) AND EXISTS(SELECT 1 FROM ik_d1_retirements WHERE id=OLD.stream_id AND kind='stream'))) BEGIN SELECT RAISE(ABORT,'IMPORT_STREAM_REVISION_CHANGED'); END";
