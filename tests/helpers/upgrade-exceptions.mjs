import assert from 'node:assert/strict';
import {expectedDataMigrations, relayBackfillCount} from './upgrade-data-expectations.mjs';
export {expectedSchema, schemaExceptions} from './upgrade-schema-expectations.mjs';

const text = value => ['text', Buffer.from(value).toString('hex')];
const integer = value => ['integer', String(value)];
const records = table => table.rows.map(row => Object.fromEntries(table.columns.map((column, i) => [column, JSON.parse(row)[i]])));
const rows = (table, values) => values.map(value => JSON.stringify(table.columns.map(column => value[column]))).sort();
const key = value => JSON.stringify([value.project_id, value.subject_id]);

// The complete exception list; each applies only when its migration is newly
// applied by the upgrade. 0106 changes only missing project secrets; 0108 inserts
// missing contact subjects with defaults and bumps every revision once. 0.4's ten
// migrations (0110-119) rewrite no pre-existing row. Wrangler appends
// d1_migrations; only its prior sqlite_sequence row may advance. Migration 298
// initializes the new relay sequence from its exact audit backfill. Migrations
// 125 and 129 change only the named columns under their exact predicates.
export const migrationExceptions = [
  {migration: '0106_project_verification_secret.sql', table: 'projects', columns: ['verification_secret'], rows: 'pre-existing projects whose secret is NULL or empty'},
  {migration: '0108_public_answer_citations.sql', table: 'context_subjects', columns: ['revision'], rows: 'existing subjects: revision + 1; missing contact subjects: exact defaults and revision 1'},
  {migration: '125_contact_email_proof.sql', table: 'contacts', columns: ['metadata_json'], rows: 'eligible unsigned email-bearing widget contacts with a matching visitor session: json_set email_unproven = 1; all other keys and rows retained'},
  {migration: '129_owner_unassigned_alerts.sql', table: 'user_project_preferences', columns: ['is_notified_on_unassigned_activity'], rows: 'owners of active non-demo workspaces with no alerted member: set 1; insert missing owner preference with is_primary default 0; retain existing is_primary and every other preference'},
  {migration: '298_agent_door_relay.sql', table: 'sqlite_sequence', columns: ['name', 'seq'], rows: 'initialize agent_door_relay to the exact eligible audit backfill count, including zero; preserve every prior sequence row'},
  {migration: 'Wrangler migration ledger', table: 'sqlite_sequence', columns: ['seq'], rows: 'name = d1_migrations only, advances by the number of newly applied migrations'},
];
export function expectedMigrationRows(before, after, migrationNames, beforeSchema) {
  // Appending the ledger cannot rewrite any previously applied migration row.
  const ledger = records(after.d1_migrations);
  assert.deepEqual(ledger.map(row => row.name).sort(), migrationNames.map(text).sort());
  for (const row of before.d1_migrations.rows) assert.ok(after.d1_migrations.rows.includes(row), 'Existing migration ledger row changed');
  const applied = new Set(records(before.d1_migrations).map(row => Buffer.from(row.name[1], 'hex').toString()));
  const added = migrationNames.filter(name => !applied.has(name));
  assert.equal(after.d1_migrations.rowCount, migrationNames.length);
  const expected = expectedDataMigrations(before, beforeSchema, added);

  if (added.includes('0106_project_verification_secret.sql')) {
    const projects = records(before.projects), projectById = new Map(records(after.projects).map(row => [JSON.stringify(row.id), row]));
    const secrets = new Set();
    for (const project of projects) {
      const migrated = projectById.get(JSON.stringify(project.id));
      assert.ok(migrated, 'Pre-existing project missing');
      assert.equal(migrated.verification_secret?.[0], 'text', 'Project verification secret must be present');
      const secret = Buffer.from(migrated.verification_secret[1], 'hex').toString();
      assert.match(secret, /^[a-f0-9]{64}$/, '0106 secret must be lowercase hex encoding of 32 random bytes');
      assert.ok(!secrets.has(secret), 'Project verification secrets must be unique');
      secrets.add(secret);
      if (JSON.stringify(project.verification_secret) === JSON.stringify(['null']) || JSON.stringify(project.verification_secret) === JSON.stringify(text(''))) {
        project.verification_secret = migrated.verification_secret;
      } else assert.deepEqual(migrated.verification_secret, project.verification_secret, '0106 must preserve an existing secret');
    }
    expected.projects = rows(before.projects, projects);
  }

  if (added.includes('0108_public_answer_citations.sql')) {
    const subjects = records(before.context_subjects), subjectKeys = new Set(subjects.map(key));
    for (const subject of subjects) {
      assert.equal(subject.revision[0], 'integer');
      subject.revision = integer(BigInt(subject.revision[1]) + 1n);
    }
    for (const contact of records(before.contacts)) {
      const subject = {project_id: contact.project_id, subject_id: contact.id, consent: integer(0), revision: integer(1), help_types: text('[]'), bot_enabled: integer(1)};
      if (!subjectKeys.has(key(subject))) { subjects.push(subject); subjectKeys.add(key(subject)); }
    }
    expected.context_subjects = rows(before.context_subjects, subjects);
  }

  const sequence = records(before.sqlite_sequence);
  const migrationSequence = sequence.find(row => JSON.stringify(row.name) === JSON.stringify(text('d1_migrations')));
  assert.ok(migrationSequence, 'Baseline migration sequence missing');
  migrationSequence.seq = integer(BigInt(migrationSequence.seq[1]) + BigInt(added.length));
  if (added.includes('298_agent_door_relay.sql')) sequence.push({name: text('agent_door_relay'), seq: integer(relayBackfillCount(before, beforeSchema))});
  expected.sqlite_sequence = rows(before.sqlite_sequence, sequence);

  const used = migrationExceptions.filter(exception => exception.migration === 'Wrangler migration ledger' || added.includes(exception.migration));
  assert.deepEqual(Object.keys(expected).sort(), [...new Set(used.map(exception => exception.table))].sort());
  // Full encoded rows still assert every non-excepted column, identity and count.
  for (const [table, expectedRows] of Object.entries(expected)) assert.deepEqual(after[table].rows, expectedRows, `Unexpected transformation in ${table}`);
  return {expected, added, exceptions: used};
}
