/**
 * One erasure of a contact at a time (migrations/315_erasure_leases.sql). An erasure takes the contact's lease before it
 * reads or writes any of the person's data, renews it while it works and its final batch deletes it
 * (`leaseCompletion`, with contact_erasures). A request that finds the lease held polls it lightly and then answers 409
 * with Retry-After; one that finds it expired (an interrupted erasure) takes it over. No lease is taken while a legacy
 * delta holds its workspace's lease (legacy-import/lease.ts), so a delta never writes during an erasure. Every expiry and
 * comparison uses the database's clock.
 */
import {dbNow} from '../../legacy-import/lease'

/** A lease lasts a minute past its last renewal; an interrupted erasure's lease can be taken over after that. */
export const ERASURE_LEASE_MS = 60_000
/** Renewed before a journal slice once this long has passed since the last renewal: about one call in 15 s. */
export const ERASURE_RENEW_MS = 15_000
/** A request for a contact being erased polls about once a second, for up to 30 s, then answers 409. */
const POLL_MS = 1_000, WAIT_MS = 30_000

/** Refused: another erasure of this contact, or a legacy delta of its workspace, holds the lease. */
export class ErasureInProgress extends Error {
  constructor(readonly retryAfter: number, readonly holder: 'erasure' | 'delta') {
    super(holder === 'delta' ? 'A legacy import is being applied to this workspace. Try the erasure again in a minute.' : 'This contact is already being erased. Try again in a minute to confirm it completed.')
  }
}
/** Another request took over the lease (this one stalled past its expiry): this request does nothing more. */
export class ErasureLeaseLost extends Error {constructor() {super('erasure_lease_lost')}}

export interface ErasureLease {
  /** Renew when ERASURE_RENEW_MS passed since the last renewal (or always, `force`); throws ErasureLeaseLost. */
  renew(force?: boolean): Promise<void>
  /** On failure: leave the row (deltas keep treating the contact as being erased) and let any request take it over. */
  release(): Promise<void>
}

/** One statement: take the lease when it is free or expired and no delta holds the workspace. ?1 project, ?2 contact, ?3 token. */
const acquire = `INSERT INTO contact_erasure_leases(project_id,contact_id,token,expires_at)
 SELECT ?1,?2,?3,${dbNow}+${ERASURE_LEASE_MS} WHERE NOT EXISTS(SELECT 1 FROM legacy_delta_leases WHERE project_id=?1 AND expires_at>${dbNow})
 ON CONFLICT(project_id,contact_id) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at WHERE contact_erasure_leases.expires_at<=${dbNow}
 RETURNING token`
/** Milliseconds until the live lease that blocks this request expires, and whose it is. Read once, when refusing. */
const blocking = `SELECT (SELECT expires_at FROM contact_erasure_leases WHERE project_id=?1 AND contact_id=?2 AND expires_at>${dbNow})-${dbNow} erasure,
 (SELECT expires_at FROM legacy_delta_leases WHERE project_id=?1 AND expires_at>${dbNow})-${dbNow} delta`
/** Only while still this request's and live: a lease that expired may already be another request's or a delta's turn. */
const renewal = `UPDATE contact_erasure_leases SET expires_at=${dbNow}+${ERASURE_LEASE_MS} WHERE project_id=?1 AND contact_id=?2 AND token=?3 AND expires_at>${dbNow} RETURNING token`

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** Take the contact's lease, waiting up to 30 s for the erasure or delta holding it; then refuse with ErasureInProgress. */
export async function takeErasureLease(db: D1Database, projectId: string, contactId: string): Promise<ErasureLease> {
  const token = crypto.randomUUID(), started = Date.now()
  for (;;) {
    if (await db.prepare(acquire).bind(projectId, contactId, token).first()) break
    if (Date.now() - started >= WAIT_MS) {
      const held = await db.prepare(blocking).bind(projectId, contactId).first<{erasure: number | null; delta: number | null}>()
      const ms = Math.max(held?.erasure ?? 0, held?.delta ?? 0)
      throw new ErasureInProgress(Math.max(1, Math.ceil(ms / 1000)), (held?.delta ?? 0) > (held?.erasure ?? 0) ? 'delta' : 'erasure')
    }
    await sleep(POLL_MS)
  }
  let renewed = Date.now()
  return {
    async renew(force = false) {
      if (!force && Date.now() - renewed < ERASURE_RENEW_MS) return
      if (!await db.prepare(renewal).bind(projectId, contactId, token).first()) throw new ErasureLeaseLost()
      renewed = Date.now()
    },
    async release() {
      await db.prepare('UPDATE contact_erasure_leases SET expires_at=0 WHERE project_id=?1 AND contact_id=?2 AND token=?3').bind(projectId, contactId, token).run()
    },
  }
}

/** In the erasure's atomic final batch: the lease goes exactly when contact_erasures is written. */
export const leaseCompletion = (db: D1Database, projectId: string, contactId: string) =>
  db.prepare('DELETE FROM contact_erasure_leases WHERE project_id=?1 AND contact_id=?2').bind(projectId, contactId)
