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

function loadTables(db, before, beforeSchema, names) {
  for (const name of names) {
    db.exec(beforeSchema[name].sql);
    const {columns, rows} = before[name];
    const insert = db.prepare(`INSERT INTO ${quote(name)}(${columns.map(quote).join(',')}) VALUES(${columns.map(() => '?').join(',')})`);
    for (const row of rows) insert.run(...JSON.parse(row).map(decode));
  }
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
