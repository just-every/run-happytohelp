/**
 * A legacy delta never runs while an erasure of its workspace runs (migrations/315_erasure_leases.sql). Before it plans,
 * a delta package takes its workspace's legacy_delta_leases row, only when no live contact_erasure_leases row exists
 * there; it renews the row on a timer for the whole run and deletes it when done. Each of its D1 batches asserts the
 * lease is still its own and live, and each upload confirms it, so a delta whose lease lapsed (its process stalled past
 * the expiry and an erasure took the workspace) writes nothing more. An erasure, in turn, never takes a contact's lease
 * while a delta holds the workspace (management/contact-erasure/lease.ts). Every expiry and comparison uses the
 * database's clock: the delta runs on an operator's machine and the erasure in the Worker.
 */

/** Epoch milliseconds by the database's clock. */
export const dbNow = "CAST(unixepoch('subsec')*1000 AS INTEGER)"

/** A minute past the last renewal; renewed every 20 s, so a lease lapses only after a stall of 40 s or more. */
export const DELTA_LEASE_MS = 60_000
const RENEW_MS = 20_000, POLL_MS = 2_000, WAIT_MS = 15 * 60_000, REPORT_EVERY = 15

/** ?1 project, ?2 token: taken when free or expired, and no erasure of the workspace holds a live lease. */
const acquire = `INSERT INTO legacy_delta_leases(project_id,token,expires_at)
 SELECT ?1,?2,${dbNow}+${DELTA_LEASE_MS} WHERE NOT EXISTS(SELECT 1 FROM contact_erasure_leases WHERE project_id=?1 AND expires_at>${dbNow})
 ON CONFLICT(project_id) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at WHERE legacy_delta_leases.expires_at<=${dbNow}
 RETURNING token`
const held = `EXISTS(SELECT 1 FROM legacy_delta_leases WHERE project_id=?1 AND token=?2 AND expires_at>${dbNow})`
const blockers = `SELECT (SELECT count(*) FROM contact_erasure_leases WHERE project_id=?1 AND expires_at>${dbNow}) erasures,
 (SELECT count(*) FROM legacy_delta_leases WHERE project_id=?1 AND expires_at>${dbNow}) deltas`

export interface DeltaLease {
  /** First statement of every delta batch: aborts the batch (ik_d1_assertions CHECK(ok=1)) unless the lease is still held. */
  assertion(db: D1Database): D1PreparedStatement
  /** Last statement of every delta batch: clears the assertion row. */
  cleared(db: D1Database): D1PreparedStatement
  /** Throws when the lease is no longer this run's and live. */
  confirm(): Promise<void>
  release(): Promise<void>
}

const lapsed = () => new Error('The legacy delta lease lapsed (this run stalled past its expiry, and an erasure may have started): nothing more was written. Run the same command again to complete the delta.')

/**
 * Take the workspace's delta lease, waiting (a progress line on stderr every 30 s, counts only) while an erasure or another
 * delta holds it, for up to 15 minutes; then stop with a message to run it again. `db` reads the target's current binding.
 */
export async function takeDeltaLease(db: () => D1Database, projectId: string, progress: (line: Record<string, unknown>) => void = () => {}): Promise<DeltaLease> {
  const token = crypto.randomUUID(), started = Date.now()
  for (let polls = 0; !await db().prepare(acquire).bind(projectId, token).first(); polls++) {
    if (Date.now() - started >= WAIT_MS) throw new Error('An erasure (or another legacy delta) of this workspace is still running after 15 minutes of waiting: nothing was written. Run the same command again once it completes.')
    if (polls % REPORT_EVERY === 0) {
      const counts = await db().prepare(blockers).bind(projectId).first<{erasures: number; deltas: number}>()
      progress({step: 'waiting', for: counts?.erasures ? 'erasure' : 'delta', erasures: counts?.erasures ?? 0, deltas: counts?.deltas ?? 0, seconds: Math.round((Date.now() - started) / 1000)})
    }
    await new Promise(resolve => setTimeout(resolve, POLL_MS))
  }
  let lost = false, renewing: Promise<unknown> = Promise.resolve()
  const renew = async () => {
    if (lost) return
    const row = await db().prepare(`UPDATE legacy_delta_leases SET expires_at=${dbNow}+${DELTA_LEASE_MS} WHERE project_id=?1 AND token=?2 AND expires_at>${dbNow} RETURNING token`).bind(projectId, token).first()
    if (!row) lost = true
  }
  // A failed renewal (a dropped connection) is tried again at the next tick; the batch assertion decides in the end.
  const timer = setInterval(() => {renewing = renew().catch(() => {})}, RENEW_MS)
  ;(timer as {unref?: () => void}).unref?.()
  return {
    assertion: database => database.prepare(`INSERT INTO ik_d1_assertions(ok) SELECT ${held}`).bind(projectId, token),
    cleared: database => database.prepare('DELETE FROM ik_d1_assertions'),
    async confirm() {
      if (lost || !(await db().prepare(`SELECT ${held} ok`).bind(projectId, token).first<{ok: number}>())?.ok) {lost = true; throw lapsed()}
    },
    async release() {
      clearInterval(timer)
      await renewing
      await db().prepare('DELETE FROM legacy_delta_leases WHERE project_id=?1 AND token=?2').bind(projectId, token).run()
    },
  }
}

/** Contacts a delta treats as erased: erased, being erased, or left mid-erasure (a lease row an interrupted erasure kept). */
export const erasedContacts = `SELECT contact_id FROM contact_erasures WHERE project_id=?1 UNION SELECT contact_id FROM contact_erasure_leases WHERE project_id=?1`
