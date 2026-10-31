import {DatabaseSync} from 'node:sqlite';

// Prior schema definitions a migration deliberately replaces. 0110 adds only the
// native import fence to the two context message triggers' bodies.
export const schemaExceptions = [
  {migration:'281_managed_connectors.sql',names:['native_integration_destinations','api_destination_filter'],change:'Adds connector origin and permits workspace-wide Zapier subscriptions while retaining machine/native origin filters'},
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
  {migration: '241_away_reply_not_a_reply.sql', names: ['workflow_changed', 'conversation_record_resolution'], change: "Adds only the away reply's (actor_role 'system') exclusions: its revision bump journals no event and is never an operator reply, and outcomes do not count it as an answer"},
  {migration: '244_csat_response_surface.sql', names: ['csat_responses', 'csat_response_history'], change: 'Adds only the signed response surface with unknown for existing feedback; every prior column and row is retained'},
  {migration: '246_imported_ticket_lifecycle.sql', names: ['ticket_conversation_defaults'], change: 'Adds only the reviewed import fence to status defaults; every other trigger clause is retained'},
  {migration: '248_customer_recovery.sql', names: ['csat_responses', 'csat_response_history'], change: 'Adds only explicit customer recovery with unknown for existing feedback; every prior column and row is retained'},
  {migration: '253_api_requests.sql', names: ['integration_tokens','native_integration_destinations'], change: 'Adds credential reference, display prefix and destination filters; legacy secret columns retained and every secret backfilled to its own credential'},
  {migration: '251_knowledge_read_selection.sql', names: ['project_roles'], change: 'Adds only nullable knowledge_article_ids TEXT constrained to a valid JSON array; every prior column and row is retained'},
  {migration: '267_translated_ai_publications.sql', names: ['knowledge_translations'], change: 'Adds nullable publication_version TEXT; every prior column definition is retained'},
  {migration: '268_help_domain_publication.sql', names: ['knowledge_experience'], change: "Adds nullable published_host TEXT and link_color TEXT NOT NULL DEFAULT ''; every prior column definition is retained"},
  {migration: '0110_move_in.sql', names: ['context_message_added', 'context_message_removed'], change: 'WHEN NOT EXISTS(SELECT 1 FROM move_in_native_fences ...) inserted before BEGIN'},
];

// Every prior table, index, trigger and view keeps its exact definition, except
// the listed replacements, which must match their documented change exactly.
export function expectedSchema(before, after, added) {
  const changed = [];
  for (const [name, entry] of Object.entries(before)) {
    const fence = added.includes('0110_move_in.sql') && {context_message_added: 'NEW', context_message_removed: 'OLD'}[name];
    let wanted = fence ? {...entry, sql: entry.sql.replace(' BEGIN ', ` WHEN NOT EXISTS(SELECT 1 FROM move_in_native_fences f WHERE f.project_id=${fence}.project_id AND f.conversation_id=${fence}.conversation_id) BEGIN `)} : entry;
    if(added.includes('281_managed_connectors.sql')&&name==='api_destination_filter')wanted={...entry,sql:entry.sql.replace("d.credential_id IS NOT NULL AND NOT EXISTS","d.credential_id IS NOT NULL AND NOT (d.connector='zapier' AND EXISTS(SELECT 1 FROM api_credentials c WHERE c.namespace=d.project_id AND c.id=d.credential_id AND c.source_product IS NULL)) AND NOT EXISTS")};
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
    if (added.includes('241_away_reply_not_a_reply.sql') && awayReplyExclusions[name]) wanted = {...wanted, sql: awayReplyExclusions[name](wanted.sql)};
    if (added.includes('246_imported_ticket_lifecycle.sql') && name === 'ticket_conversation_defaults') wanted = {...wanted, sql: importedStatusDefaults(wanted.sql)};
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

// 241 keeps every other byte of both triggers, including 195's boundaries.
const awayReply = "(SELECT actor_role FROM messages WHERE id=NEW.last_message_id) IS NOT 'system'";
const awayReplyExclusions = {
  workflow_changed: sql => sql.replace('AND (NEW.revision<>OLD.revision OR', `AND ((NEW.revision<>OLD.revision AND ${awayReply}) OR`).replace("WHEN NEW.revision<>OLD.revision THEN 'operator_reply'", `WHEN NEW.revision<>OLD.revision AND ${awayReply} THEN 'operator_reply'`),
  conversation_record_resolution: sql => sql.replaceAll("m.actor_role<>'contact' AND", "m.actor_role NOT IN ('contact','system') AND"),
};
const importedStatusDefaults = sql => ['status_id','status_category'].reduce((definition,column)=>definition.replace(`${column}= CASE WHEN`,`${column}= CASE WHEN EXISTS(SELECT 1 FROM move_in_native_fences f WHERE f.project_id=NEW.project_id AND f.conversation_id=NEW.id) THEN NEW.${column} WHEN`),sql);

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
  {migration:'281_managed_connectors.sql',table:'native_integration_destinations',sql:"ALTER TABLE native_integration_destinations ADD COLUMN connector TEXT NOT NULL DEFAULT 'native';"},
  {migration:"257_sla_slack.sql",table:"sla_policies",sql:"ALTER TABLE sla_policies ADD COLUMN slack_destination_id TEXT;"},
  {migration:"257_sla_slack.sql",table:"sla_alerts",sql:"ALTER TABLE sla_alerts ADD COLUMN slack_destination_id TEXT; ALTER TABLE sla_alerts ADD COLUMN slack_state TEXT NOT NULL DEFAULT 'not_configured'; ALTER TABLE sla_alerts ADD COLUMN slack_attempts INTEGER NOT NULL DEFAULT 0; ALTER TABLE sla_alerts ADD COLUMN slack_started_at INTEGER; ALTER TABLE sla_alerts ADD COLUMN slack_next_attempt_at INTEGER; ALTER TABLE sla_alerts ADD COLUMN slack_error TEXT;"},
  {migration:"258_teams_escalations.sql",table:"escalation_connections",sql:"ALTER TABLE escalation_connections ADD COLUMN installed_by TEXT;"},
  {migration:"259_account_lookup_fields.sql",table:"ticket_fields",sql:"DROP TABLE ticket_fields; CREATE TABLE ticket_fields(project_id TEXT NOT NULL REFERENCES projects(id),id TEXT NOT NULL,name TEXT NOT NULL,type TEXT NOT NULL CHECK(type IN ('text','number','decimal','date','dropdown','multiselect','checkbox','regex','account')),required INTEGER NOT NULL DEFAULT 0,options_json TEXT NOT NULL DEFAULT '[]',validation_json TEXT NOT NULL DEFAULT '{}',read_roles_json TEXT NOT NULL DEFAULT '[]',write_roles_json TEXT NOT NULL DEFAULT '[]',updated_at INTEGER NOT NULL,PRIMARY KEY(project_id,id));"},
  {migration:'253_api_requests.sql',table:'integration_tokens',sql:[
    'credential_id TEXT','display_prefix TEXT',
  ].map(column=>`ALTER TABLE integration_tokens ADD COLUMN ${column};`).join('\n')},
  {migration:'253_api_requests.sql',table:'native_integration_destinations',sql:'ALTER TABLE native_integration_destinations ADD COLUMN credential_id TEXT; ALTER TABLE native_integration_destinations ADD COLUMN source_product TEXT;'},

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
  {migration: '267_translated_ai_publications.sql', table: 'knowledge_translations', sql: 'ALTER TABLE knowledge_translations ADD COLUMN publication_version TEXT'},
  {migration: '268_help_domain_publication.sql', table: 'knowledge_experience', sql: "ALTER TABLE knowledge_experience ADD COLUMN published_host TEXT; ALTER TABLE knowledge_experience ADD COLUMN link_color TEXT NOT NULL DEFAULT ''"},
  {migration: '190_email_step_up.sql', table: 'session_factors', sql: `CREATE TABLE session_factors_email(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,method TEXT NOT NULL CHECK(method IN ('password','email_link','totp','webauthn','recovery','installation')),verified_at INTEGER NOT NULL); DROP TABLE session_factors; ALTER TABLE session_factors_email RENAME TO session_factors`},
  ...['csat_responses','csat_response_history'].map(table=>({migration:'244_csat_response_surface.sql',table,sql:`ALTER TABLE ${table} ADD COLUMN response_surface TEXT NOT NULL DEFAULT 'unknown' CHECK(response_surface IN ('email','portal','widget','unknown'))`})),
  ...['csat_responses','csat_response_history'].map(table=>({migration:'248_customer_recovery.sql',table,sql:`ALTER TABLE ${table} ADD COLUMN recovery TEXT NOT NULL DEFAULT 'unknown' CHECK(recovery IN ('unknown','recovered','not_recovered'))`})),
  {migration: '251_knowledge_read_selection.sql', table: 'project_roles', sql: "ALTER TABLE project_roles ADD COLUMN knowledge_article_ids TEXT CHECK(knowledge_article_ids IS NULL OR (json_valid(knowledge_article_ids) AND json_type(knowledge_article_ids)='array'))"},
];
const messageSubjectTrigger = 'CREATE TRIGGER context_message_added AFTER INSERT ON messages WHEN NOT EXISTS(SELECT 1 FROM move_in_native_fences f WHERE f.project_id=NEW.project_id AND f.conversation_id=NEW.conversation_id) BEGIN UPDATE context_subjects SET revision=revision+1 WHERE project_id=NEW.project_id AND subject_id IN (SELECT contact_id FROM conversations WHERE id=NEW.conversation_id AND project_id=NEW.project_id UNION SELECT NEW.actor_id); END';
const streamRetirementTrigger = "CREATE TRIGGER ik_d1_stream_revision_update BEFORE UPDATE ON ik_d1_stream_revisions WHEN NEW.stream_id IS NOT OLD.stream_id OR NEW.destination IS NOT OLD.destination OR NEW.mapping_version IS NOT OLD.mapping_version OR NEW.principal_id IS NOT OLD.principal_id OR NEW.fingerprint IS NOT OLD.fingerprint OR NEW.total IS NOT OLD.total OR NEW.layout_hash IS NOT OLD.layout_hash OR NEW.layout_revision<OLD.layout_revision OR NEW.progress_revision<=OLD.progress_revision OR ((NEW.namespace IS NOT OLD.namespace OR NEW.operation_key IS NOT OLD.operation_key) AND NOT (NEW.namespace='' AND NEW.operation_key='' AND NOT EXISTS(SELECT 1 FROM ik_d1_streams WHERE id=OLD.stream_id) AND EXISTS(SELECT 1 FROM ik_d1_retirements WHERE id=OLD.stream_id AND kind='stream'))) BEGIN SELECT RAISE(ABORT,'IMPORT_STREAM_REVISION_CHANGED'); END";
