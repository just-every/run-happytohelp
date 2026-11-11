import type { Forms } from './team.ts';
import type { Database, Guard, ManagedMember, Member, Statement } from './types.ts';

// Retiring an erased person from the Business roster.
//
// `bs_settings.document` is the verified payload of the last accepted revision, stored as JSON. The
// signature is checked once, when the revision is received (verify.ts); it is not stored and never
// checked again on read, so removing a roster entry from the stored copy invalidates nothing and no
// signature is ever forged. The Business keeps its own copy and will list the person again in its next
// revision, so a tombstone is kept: only domain-separated SHA-256 digests of the roster address and
// the Business member id, with the invite number the person had. Those digests are never turned back
// into a name or an address by this module.

/** Every table this module owns, and what erasing a roster person does to it. Checked at erasure. */
export const rosterArtifacts = [
  { table: 'bs_team', columns: ['email', 'operator_id', 'invite', 'state', 'business_id', 'business_role'], erasure: 'purge the person\'s row' },
  { table: 'bs_settings', columns: ['singleton', 'rev', 'document', 'applied_at', 'stopped', 'token', 'owner_id'], erasure: 'remove the person\'s entry from the stored document\'s team' },
  { table: 'bs_retired', columns: ['digest', 'invite', 'erasure_id'], erasure: 'receive the value-free tombstone' },
  { table: 'bs_overrides', columns: ['field', 'value', 'actor', 'changed_at'], erasure: 'actor becomes the erasure marker' },
  { table: 'bs_audit', columns: ['id', 'actor', 'action', 'field', 'changed_at'], erasure: 'actor becomes the erasure marker' },
  { table: 'bs_logo', columns: ['singleton', 'sha256', 'type', 'bytes'], erasure: 'unrelated: the Business logo' },
  { table: 'bs_assert', columns: ['value'], erasure: 'unrelated: transaction fence, always empty between batches' },
] as const;

export interface Tombstone { erasure_id: string }
export type Retirement = { digest: string; invite: number };

async function sha256(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}
export const emailDigest = (email: string) => sha256('rer-business-roster-retired/1\nemail\n' + email.trim().toLowerCase());
export const idDigest = (id: string) => sha256('rer-business-roster-retired/1\nid\n' + id);
const digests = async (member: Pick<Member, 'email' | 'id'>, forms: readonly string[] = []) =>
  [await emailDigest(member.email), ...await Promise.all(forms.map(emailDigest)), ...member.id ? [await idDigest(member.id)] : []];

/** Every Business table is accounted for, including those a later migration adds. */
export async function checkRosterArtifacts(db: Database): Promise<void> {
  const tables = (await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name GLOB 'bs_*' ORDER BY name").all<{ name: string }>()).results;
  for (const { name } of tables) {
    const declared = rosterArtifacts.find(item => item.table === name);
    if (!declared) throw new Error('business_roster_undeclared_table:' + name);
    const columns = (await db.prepare(`PRAGMA table_info("${name}")`).all<{ name: string }>()).results.map(column => column.name);
    if (JSON.stringify([...columns].sort()) !== JSON.stringify([...declared.columns].sort())) throw new Error('business_roster_undeclared_column:' + name);
  }
  for (const item of rosterArtifacts) if (!tables.some(table => table.name === item.table)) throw new Error('business_roster_missing_table:' + item.table);
}

/** Statements for the seed's own erasure transaction. `refs` are the erased operator's `person:` policy
 * references (`operatorPolicyRefs`); an operator the Business never listed changes nothing here.
 * Selection is by value, not by row snapshot, so a Business revision racing the erasure cannot keep them. */
export async function rosterRetirementStatements(db: Database, refs: readonly string[], tombstone: Tombstone): Promise<Statement[]> {
  const present = (await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN('bs_team','oa_operators')").all<{ name: string }>()).results.map(row => row.name);
  if (!present.includes('bs_team')) return [];
  await checkRosterArtifacts(db);
  const ids = JSON.stringify(refs.map(ref => ref.replace(/^person:/, '')));
  // The erased operator's own row, and no other operator's whose id happens to equal a Business id.
  const rows = (await db.prepare(`SELECT email,operator_id AS operatorId,invite,business_id AS businessId FROM bs_team
    WHERE operator_id IN(SELECT value FROM json_each(?1)) AND (business_id IS NULL OR business_id IN(SELECT value FROM json_each(?1)))`).bind(ids).all<{ email: string; operatorId: string; invite: number; businessId: string | null }>()).results;
  if (!rows.length) return [];
  const operatorIds = [...new Set(rows.map(row => row.operatorId))];
  // The address the person signs in with can differ from the roster address after a self-service change.
  const native = present.includes('oa_operators')
    ? (await db.prepare('SELECT email FROM oa_operators WHERE id IN(SELECT value FROM json_each(?))').bind(JSON.stringify(operatorIds)).all<{ email: string }>()).results.map(row => row.email) : [];
  const emails = [...new Set([...rows.map(row => row.email), ...native])];
  const businessIds = [...new Set(rows.flatMap(row => row.businessId ? [row.businessId] : []))];
  const invite = Math.max(...rows.map(row => row.invite));
  const marker = 'person:erased:' + tombstone.erasure_id;
  const keys = [...await Promise.all(emails.map(emailDigest)), ...await Promise.all(businessIds.map(idDigest))];
  const emailList = JSON.stringify(emails), idList = JSON.stringify(businessIds), actors = JSON.stringify([...operatorIds, ...emails]);
  return [
    ...keys.map(digest => db.prepare(`INSERT INTO bs_retired(digest,invite,erasure_id) VALUES(?,?,?)
      ON CONFLICT(digest) DO UPDATE SET invite=max(invite,excluded.invite),erasure_id=excluded.erasure_id`).bind(digest, invite, tombstone.erasure_id)),
    db.prepare(`UPDATE bs_settings SET document=json_set(document,'$.team',(SELECT json_group_array(json(member.value)) FROM json_each(bs_settings.document,'$.team') member
      WHERE coalesce(json_extract(member.value,'$.email'),'') NOT IN(SELECT value FROM json_each(?1)) AND coalesce(json_extract(member.value,'$.id'),'') NOT IN(SELECT value FROM json_each(?2))))
      WHERE document IS NOT NULL AND json_valid(document) AND json_type(document,'$.team')='array'`).bind(emailList, idList),
    db.prepare(`DELETE FROM bs_team WHERE (operator_id IN(SELECT value FROM json_each(?1)) AND (business_id IS NULL OR business_id IN(SELECT value FROM json_each(?2)))) OR email IN(SELECT value FROM json_each(?3))`)
      .bind(JSON.stringify(operatorIds), idList, emailList),
    db.prepare('UPDATE bs_overrides SET actor=? WHERE actor IN(SELECT value FROM json_each(?))').bind(marker, actors),
    db.prepare('UPDATE bs_audit SET actor=? WHERE actor IN(SELECT value FROM json_each(?))').bind(marker, actors),
  ];
}

/** `erasure_id` of a tombstone written because the adapter reported the native identity gone (no erasure record). */
const nativeGone = 'native-identity-gone';
export interface Gone { statements: Statement[]; emails: Set<string>; businessIds: Set<string> }
/** Retire the stored roster rows whose native identity the seed's adapter reported gone, in the apply batch.
 * `stored` are the rows as persisted (what an earlier erasure left behind) and `projected` the same rows with
 * the current listing's address and Business id; both addresses and the Business id are tombstoned, with the
 * invite number each row had. The caller omits them from the new roster and the stored document. */
export async function retireGone(stored: ManagedMember[], projected: ManagedMember[], gone: readonly string[], guard: Guard, db: Database): Promise<Gone | null> {
  const ids = new Set(gone);
  const emails = new Set<string>(), businessIds = new Set<string>(), statements: Statement[] = [];
  for (const [index, row] of stored.entries()) {
    if (!row.operatorId || !ids.has(row.operatorId)) continue;
    const listed = projected[index]!;
    const rowEmails = [row.email, listed.email], rowIds = [row.businessId, listed.businessId].filter((id): id is string => !!id);
    rowEmails.forEach(email => emails.add(email)); rowIds.forEach(id => businessIds.add(id));
    const keys = [...await Promise.all(rowEmails.map(emailDigest)), ...await Promise.all(rowIds.map(idDigest))];
    for (const digest of new Set(keys)) statements.push(db.prepare(`INSERT INTO bs_retired(digest,invite,erasure_id) SELECT ?,?,? WHERE ${guard.sql}
      ON CONFLICT(digest) DO UPDATE SET invite=max(invite,excluded.invite)`).bind(digest, row.invite, nativeGone, ...guard.args));
  }
  return statements.length ? { statements, emails, businessIds } : null;
}

export interface Screen { kept: Member[]; retired: string[]; readmit: string[]; checks: Array<{ digest: string; invite: number }> }
/** Split a signed roster into the people it may apply and those the installation erased. A larger invite
 * number than the one the person had when erased is the Business's explicit new invitation. */
export async function screenRoster(db: Database, members: Member[], forms: Forms = new Map()): Promise<Screen> {
  const kept: Member[] = [], retired: string[] = [], readmit: string[] = [], checks: Screen['checks'] = [];
  const lookup = db.prepare('SELECT digest,invite FROM bs_retired WHERE digest IN(SELECT value FROM json_each(?))');
  for (const item of members) {
    const keys = await digests(item, forms.get(item.email));
    const found = (await lookup.bind(JSON.stringify(keys)).all<{ digest: string; invite: number }>()).results;
    if (found.some(row => row.invite >= item.invite)) { retired.push(item.email); continue; }
    kept.push(item);
    readmit.push(...found.map(row => row.digest));
    checks.push(...keys.map(digest => ({ digest, invite: item.invite })));
  }
  return { kept, retired, readmit, checks };
}
