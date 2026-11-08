import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {snapshotTable} from './upgrade-snapshot.mjs';

const quote = name => '"' + name.replaceAll('"', '""') + '"';
function decode([type, value]) {
  if (type === 'null') return null;
  if (type === 'integer') return BigInt(value);
  if (type === 'real') return Buffer.from(value, 'hex').readDoubleBE();
  const bytes = Buffer.from(value, 'hex');
  return type === 'text' ? bytes.toString() : bytes;
}

function loadTables(db, before, beforeSchema, names, replace = false) {
  for (const name of names) {
    if (replace) db.exec(`DELETE FROM ${quote(name)}`);
    else db.exec(beforeSchema[name].sql);
    const {columns, rows} = before[name];
    const insert = db.prepare(`INSERT INTO ${quote(name)}(${columns.map(quote).join(',')}) VALUES(${columns.map(() => '?').join(',')})`);
    for (const row of rows) insert.run(...JSON.parse(row).map(decode));
  }
}

const contactIndex = "CREATE VIRTUAL TABLE inbox_contact_search USING fts5(name,email,provided_name,provided_email,content='inbox_contact_identity',content_rowid='rowid',tokenize='trigram case_sensitive 1')";
const contactShadows = ['inbox_contact_search_data', 'inbox_contact_search_idx', 'inbox_contact_search_docsize', 'inbox_contact_search_config'];
function indexedContactDocuments(db) {
  db.exec("CREATE VIRTUAL TABLE contact_terms USING fts5vocab(inbox_contact_search,'instance')");
  const documents = new Map(db.prepare('SELECT CAST(id AS TEXT) AS id FROM inbox_contact_search_docsize').all().map(row => [row.id, []]));
  for (const row of db.prepare('SELECT CAST(doc AS TEXT) AS doc,term,col,CAST(offset AS TEXT) AS offset FROM contact_terms ORDER BY term,col,offset').all()) {
    assert.ok(documents.has(row.doc), '310 index term belongs to an indexed contact');
    documents.get(row.doc).push([row.term, row.col, row.offset]);
  }
  return [...documents.values()].map(tokens => JSON.stringify(tokens)).sort();
}

// 310 creates a new derived contact index; it never rewrites contacts. The
// snapshot has no source rowids, so compare the exact identity projection and
// multiset of per-document indexed tokens, including empty identities. Do not
// invent rowid-to-contact associations that this snapshot cannot represent.
// 311 changes only the existing message index's secure-delete configuration
// and structure record. Restore its exact shadow bytes, then let SQLite compute
// that command's result without rebuilding or retokenizing any prior message.
export function expectedInboxSearch(before, after, beforeSchema, added, expected) {
  const db = new DatabaseSync(':memory:', {enableForeignKeyConstraints: false});
  try {
    if (added.includes('310_inbox_contact_search.sql')) {
      assert.deepEqual(after.contacts.rows, expected.contacts ?? before.contacts.rows, '310 preserves every contact outside earlier exact transformations');
      assert.deepEqual(after.messages.rows, before.messages.rows, '310 preserves every message');
      loadTables(db, after, beforeSchema, ['contacts']);
      db.exec(`CREATE VIEW inbox_contact_identity AS SELECT rowid AS rowid,
        lower(coalesce(name,'')) AS name,lower(coalesce(email,'')) AS email,
        lower(coalesce(iif(json_valid(metadata_json),json_extract(metadata_json,'$.provided_name'),NULL),'')) AS provided_name,
        lower(coalesce(iif(json_valid(metadata_json),json_extract(metadata_json,'$.provided_email'),NULL),'')) AS provided_email FROM contacts;
        ${contactIndex};
        INSERT INTO inbox_contact_search(inbox_contact_search,rank) VALUES('secure-delete',1);
        INSERT INTO inbox_contact_search(inbox_contact_search) VALUES('rebuild');`);
      for (const name of ['inbox_contact_search', 'inbox_contact_search_config']) {
        assert.deepEqual(after[name].rows, snapshotTable(db, name, after[name].columns).rows, `310 derives ${name} from every retained contact`);
      }
      assert.equal(after.inbox_contact_search_docsize.rowCount, after.contacts.rowCount, '310 indexes every retained contact, including empty identities');
      const index = new DatabaseSync(':memory:');
      try {
        index.exec(contactIndex);
        loadTables(index, after, beforeSchema, contactShadows, true);
        assert.deepEqual(indexedContactDocuments(index), indexedContactDocuments(db), '310 indexes the exact tokens of every retained contact');
      } finally { index.close(); }
    }
    if (added.includes('311_inbox_message_secure_delete.sql') && before.inbox_message_search) {
      db.exec(beforeSchema.inbox_message_search.sql);
      loadTables(db, before, beforeSchema, ['inbox_message_search_data', 'inbox_message_search_idx', 'inbox_message_search_docsize', 'inbox_message_search_config'], true);
      db.exec("INSERT INTO inbox_message_search(inbox_message_search,rank) VALUES('secure-delete',1)");
      for (const name of ['inbox_message_search_config', 'inbox_message_search_data']) {
        expected[name] = snapshotTable(db, name, before[name].columns).rows;
      }
      assert.deepEqual(after.messages.rows, before.messages.rows, '311 preserves every message');
    }
  } finally { db.close(); }
}

// Migration 298 inserts one relay row per eligible prior audit row. Earlier
// releases have no agent door tables, so their new relay starts at zero.
export function relayBackfillCount(before, beforeSchema) {
  if (!before.agent_door_audit || !before.agent_door_state) return 0n;
  const db = new DatabaseSync(':memory:', {enableForeignKeyConstraints: false});
  try {
    loadTables(db, before, beforeSchema, ['agent_door_audit', 'agent_door_state']);
    const statement = db.prepare(`SELECT count(*) AS count FROM agent_door_audit
      WHERE json_extract(row,'$.door')='mcp' AND json_extract(row,'$.consent') IS NOT NULL
        AND (SELECT json_extract(envelope,'$.business') FROM agent_door_state WHERE id=1) IS NOT NULL`);
    statement.setReadBigInts(true);
    return statement.get().count;
  } finally { db.close(); }
}

// Execute only the documented column transformations on the exact prior rows.
// SQLite preserves json_set formatting, NULL predicates, defaults and upsert
// selection; application triggers are deliberately absent from this expectation.
export function expectedDataMigrations(before, beforeSchema, added) {
  const expected = {}, db = new DatabaseSync(':memory:', {enableForeignKeyConstraints: false});
  try {
    loadTables(db, before, beforeSchema, ['contacts', 'sessions', 'memberships', 'projects', 'project_settings', 'user_project_preferences']);
    if (added.includes('125_contact_email_proof.sql')) {
      // Only metadata_json.email_unproven for unsigned, email-bearing widget
      // contacts with a matching visitor session. Signed identities are retained.
      db.exec(`UPDATE contacts SET metadata_json=json_set(coalesce(metadata_json,'{}'),'$.email_unproven',1)
        WHERE (email IS NOT NULL OR json_extract(metadata_json,'$.provided_email') IS NOT NULL)
        AND NOT (coalesce(is_verified,0)=1 AND email IS NOT NULL AND lower(trim(external_id))=lower(trim(email)) AND json_extract(metadata_json,'$.provided_email') IS NULL)
        AND EXISTS(SELECT 1 FROM sessions s WHERE s.contact_id=contacts.id AND s.project_id=contacts.project_id AND s.role='contact')`);
      expected.contacts = snapshotTable(db, 'contacts', before.contacts.columns).rows;
    }
    if (added.includes('129_owner_unassigned_alerts.sql')) {
      // Only active non-demo workspaces without an alerted member. Existing
      // is_primary stays exact; missing owner preferences receive its default 0.
      db.exec(`INSERT INTO user_project_preferences(project_id,user_id,is_notified_on_unassigned_activity)
        SELECT m.project_id,m.user_id,1 FROM memberships m JOIN projects p ON p.id=m.project_id LEFT JOIN project_settings s ON s.project_id=p.id
        WHERE m.role='owner' AND COALESCE(json_extract(s.settings_json,'$.is_demo'),0)<>1 AND json_extract(s.settings_json,'$.deleted_at') IS NULL
        AND NOT EXISTS(SELECT 1 FROM user_project_preferences pref WHERE pref.project_id=m.project_id AND pref.is_notified_on_unassigned_activity=1)
        ON CONFLICT(project_id,user_id) DO UPDATE SET is_notified_on_unassigned_activity=1`);
      expected.user_project_preferences = snapshotTable(db, 'user_project_preferences', before.user_project_preferences.columns).rows;
    }
    return expected;
  } finally { db.close(); }
}
