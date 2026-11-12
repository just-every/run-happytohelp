/** Only account credential state crosses workspace roots here. The caller's
 * existing atomic member-erasure guard must precede these statements. Opaque
 * recovery epochs/events stay as history; no workspace business row is erased. */
export function recoveryMemberErasure(db:D1Database,userId:string){
 return [
  // Removing a consent cannot turn a stale request into one that can be renewed.
  db.prepare("UPDATE identity_recovery_requests SET state='cancelled',pending_secret=NULL,pending_passkey=NULL,passkey_challenge=NULL WHERE state IN ('pending','authorized') AND id IN (SELECT request_id FROM identity_recovery_approvals WHERE user_id=?)").bind(userId),
  db.prepare('DELETE FROM identity_recovery_requests WHERE user_id=?').bind(userId),
  db.prepare('DELETE FROM identity_recovery_approvals WHERE user_id=?').bind(userId),
 ]
}
