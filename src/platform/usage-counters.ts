import type { Env } from './env'
import { hashToken } from './auth'

/** A fixed UTC-aligned window; daily windows reset at 00:00 UTC. */
export interface CounterWindow { name: string; seconds: number }
export interface CounterPosition { key: string; windowStart: number; expiresAt: number }

export async function counterPosition(window: CounterWindow, subject: string, now = Date.now()): Promise<CounterPosition> {
 const length = window.seconds * 1000, windowStart = Math.floor(now / length) * length
 return { key: `${window.name}:${await hashToken(subject)}`, windowStart, expiresAt: windowStart + length }
}

// A request whose clock reading is older than the stored window (it read the clock just
// before a boundary but wrote just after another request opened the next window) counts
// against the newer stored window. Resetting to the older window instead would let each
// such straggler restart the count and admit more than twice the limit across a boundary.
const merged = `CASE WHEN abuse_counters.window_start>=excluded.window_start THEN abuse_counters.used+excluded.used ELSE excluded.used END`
const upsert = `INSERT INTO abuse_counters(key,window_start,used,expires_at) VALUES(?,?,?,?)
  ON CONFLICT(key) DO UPDATE SET used=${merged},window_start=max(abuse_counters.window_start,excluded.window_start),expires_at=max(abuse_counters.expires_at,excluded.expires_at)`

/**
 * Atomically add `amount` unless the window total would exceed `limit`.
 * A refused attempt is not counted, so waiting out the window always recovers.
 * The returned position is the window the attempt was counted against (or refused by).
 */
export async function consumeCounter(env: Env, window: CounterWindow, subject: string, limit: number, amount = 1, now = Date.now()) {
 const position = await counterPosition(window, subject, now)
 if (amount > limit) return { allowed: false, used: null, ...position }
 const row = await env.DB.prepare(`${upsert} WHERE ${merged}<=? RETURNING used,window_start,expires_at`)
  .bind(position.key, position.windowStart, amount, position.expiresAt, limit).first<{ used: number; window_start: number; expires_at: number }>()
 if (row) return { allowed: true, used: row.used, key: position.key, windowStart: row.window_start, expiresAt: row.expires_at }
 const stored = await env.DB.prepare('SELECT window_start,expires_at FROM abuse_counters WHERE key=?').bind(position.key).first<{ window_start: number; expires_at: number }>()
 const refusedBy = stored && stored.window_start > position.windowStart ? { windowStart: stored.window_start, expiresAt: stored.expires_at } : {}
 return { allowed: false, used: null, ...position, ...refusedBy }
}

/** Unconditional accumulation (used for observed spend, which is known only after the provider reports it). */
export async function addToCounter(env: Env, window: CounterWindow, subject: string, amount: number, now = Date.now()) {
 const position = await counterPosition(window, subject, now)
 await env.DB.prepare(upsert).bind(position.key, position.windowStart, amount, position.expiresAt).run()
}

/** Return capacity taken for work that was not admitted after all. */
export async function refundCounter(env: Env, position: CounterPosition, amount = 1) {
 await env.DB.prepare('UPDATE abuse_counters SET used=max(used-?,0) WHERE key=? AND window_start=?').bind(amount, position.key, position.windowStart).run()
}

export async function readCounter(env: Env, window: CounterWindow, subject: string, now = Date.now()) {
 const position = await counterPosition(window, subject, now)
 const row = await env.DB.prepare('SELECT used FROM abuse_counters WHERE key=? AND window_start=?').bind(position.key, position.windowStart).first<{ used: number }>()
 return { used: row?.used ?? 0, ...position }
}
