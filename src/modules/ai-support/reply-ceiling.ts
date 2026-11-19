import { HTTPException } from 'hono/http-exception'
import type { Env } from '../../platform/env'
import { aiCeilings } from '../../platform/limit-config'
import { addToCounter, consumeCounter, readCounter, refundCounter, type CounterWindow } from '../../platform/usage-counters'

// Automatic replies are generations a visitor (contact actor) caused: live widget
// messages, email replies, insight answers and widget reply requests.
const day = 86400
export const replyWindow: CounterWindow = { name: 'ai:replies-per-project', seconds: day }
export const installationReplyWindow: CounterWindow = { name: 'ai:replies-per-installation', seconds: day }
export const replySpendWindow: CounterWindow = { name: 'ai:reply-spend-micro-usd', seconds: day }
export const skippedReplyWindow: CounterWindow = { name: 'ai:reply-ceiling-skips', seconds: day }
export const CEILING_PREFIX = 'AI_REPLY_CEILING:'
const INSTALLATION = 'installation'
const replies = (count: number) => `${count} automatic ${count === 1 ? 'reply' : 'replies'}`

/** Seconds until the daily ceilings reset at 00:00 UTC (at least one). */
export function secondsUntilCeilingReset(now = Date.now()) {
 const dayMs = day * 1000
 return Math.max(1, Math.ceil(((Math.floor(now / dayMs) + 1) * dayMs - now) / 1000))
}

/** Whether a recorded generation is a ceiling skip decided in the current UTC day. */
export function ceilingSkipToday(generation: { state: string; error?: string | null; created_at: string }, now = Date.now()) {
 return generation.state === 'failed' && !!generation.error?.startsWith(CEILING_PREFIX) && Math.floor(Date.parse(generation.created_at) / (day * 1000)) === Math.floor(now / (day * 1000))
}

/**
 * A visitor's explicit AI request refused by a daily ceiling. The visitor learns only that
 * the assistant is unavailable until the reset; which ceiling, and the project's spend,
 * stay in the operator-visible generation record and usage.
 */
export class AiReplyCeilingReached extends HTTPException {
 readonly retryAfter: number
 constructor(now = Date.now()) {
  const retryAfter = secondsUntilCeilingReset(now), error = 'The assistant is not available right now. Please leave a message for the team or try again later.'
  super(429, { message: error, res: Response.json({ error, code: 'rate_limited', limit: 'aiReplies', retryAfter }, { status: 429, headers: { 'Retry-After': String(retryAfter) } }) })
  this.retryAfter = retryAfter
 }
}

export type ReplyAdmission = { admitted: true; refund(): Promise<void> } | { admitted: false; reason: string }

/** Reserve one automatic reply against the project's and installation's daily ceilings. */
export async function admitAutomaticReply(env: Env, projectId: string): Promise<ReplyAdmission> {
 const limits = aiCeilings(env), pause = 'Automatic AI replies are paused until 00:00 UTC; the visitor message was saved for a human reply.'
 const spend = await readCounter(env, replySpendWindow, projectId)
 if (spend.used >= limits.spendUsdPerProject * 1e6) return { admitted: false, reason: `${CEILING_PREFIX} ${pause} This project's estimated automatic-reply spend today ($${(spend.used / 1e6).toFixed(2)}) reached its daily ceiling of $${limits.spendUsdPerProject} (AI_DAILY_CEILINGS.spendUsdPerProject).` }
 const project = await consumeCounter(env, replyWindow, projectId, limits.repliesPerProject)
 if (!project.allowed) return { admitted: false, reason: `${CEILING_PREFIX} ${pause} This project reached its daily ceiling of ${replies(limits.repliesPerProject)} (AI_DAILY_CEILINGS.repliesPerProject).` }
 const installation = await consumeCounter(env, installationReplyWindow, INSTALLATION, limits.repliesPerInstallation)
 if (!installation.allowed) {
  await refundCounter(env, project)
  return { admitted: false, reason: `${CEILING_PREFIX} ${pause} This installation reached its daily ceiling of ${replies(limits.repliesPerInstallation)} across all projects (AI_DAILY_CEILINGS.repliesPerInstallation).` }
 }
 return { admitted: true, refund: async () => { await refundCounter(env, project); await refundCounter(env, installation) } }
}

export async function recordSkippedReply(env: Env, projectId: string) {
 await addToCounter(env, skippedReplyWindow, projectId, 1)
}

/** Provider-reported cost of automatic replies, accumulated as the provider reports each round. */
export async function recordAutomaticReplySpend(env: Env, attemptId: string, requestId: string, cost: unknown) {
 if (typeof cost !== 'number' || !Number.isFinite(cost) || cost <= 0) return
 const row = await env.DB.prepare(`SELECT g.project_id,(SELECT json_extract(u.usage_json,'$.cost') FROM ai_round_usage u WHERE u.attempt_id=a.id AND u.request_id=?) prior
  FROM ai_attempts a JOIN ai_generations g ON g.id=a.generation_id
  WHERE a.id=? AND json_extract(g.actor_json,'$.role')='contact'`).bind(requestId, attemptId).first<{ project_id: string; prior: number | null }>()
 if (!row) return
 const delta = Math.round((cost - (typeof row.prior === 'number' ? row.prior : 0)) * 1e6)
 if (delta > 0) await addToCounter(env, replySpendWindow, row.project_id, delta)
}

export async function automaticAiUsage(env: Env, projectId: string) {
 const limits = aiCeilings(env)
 const [replies, installation, spend, skipped] = await Promise.all([replyWindow, installationReplyWindow, replySpendWindow, skippedReplyWindow].map((window, index) => readCounter(env, window, index === 1 ? INSTALLATION : projectId)))
 const replyCeilingReached = replies.used >= limits.repliesPerProject || installation.used >= limits.repliesPerInstallation || spend.used >= limits.spendUsdPerProject * 1e6
 return {
  day: new Date(replies.windowStart).toISOString().slice(0, 10),
  resetsAt: new Date(replies.expiresAt).toISOString(),
  replies: { used: replies.used, limit: limits.repliesPerProject },
  spendUsd: { used: spend.used / 1e6, limit: limits.spendUsdPerProject },
  installationReplies: { limit: limits.repliesPerInstallation },
  installationCeilingReached: installation.used >= limits.repliesPerInstallation,
  skippedReplies: skipped.used,
  replyCeilingReached,
 }
}
