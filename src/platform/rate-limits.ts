import { HTTPException } from 'hono/http-exception'
import type { Env } from './env'
import { rateLimits, type RateLimitName } from './limit-config'
import { consumeCounter, refundCounter, type CounterPosition } from './usage-counters'

const windows: Record<RateLimitName, number> = {
 apiRequestsPerTokenMinute: 60,
 outboundNoticesPerProjectMinute: 60,
 widgetSessionsPerIpHour: 3600,
 widgetSessionsPerProjectHour: 3600,
 conversationsPerContactHour: 3600,
 conversationsPerIpHour: 3600,
 conversationsPerProjectHour: 3600,
 messagesPerContactHour: 3600,
 messagesPerConversationMinute: 60,
 widgetEventsPerContactMinute: 60,
 uploadsPerContactDay: 86400,
 uploadBytesPerContactDay: 86400,
 uploadsPerProjectDay: 86400,
 uploadBytesPerProjectDay: 86400,
 registrationsPerIpDay: 86400,
 projectsPerIpDay: 86400,
 projectsPerAccountDay: 86400,
}

const messages: Record<RateLimitName, string> = {
 outboundNoticesPerProjectMinute: 'Outbound notice rate limit reached; this notice was not sent.',
 apiRequestsPerTokenMinute: 'API token request limit exceeded. Try again shortly.',
 widgetSessionsPerIpHour: 'Too many chat sessions were started from this network. Please try again later.',
 widgetSessionsPerProjectHour: 'This chat is very busy right now. Please try again later.',
 conversationsPerContactHour: 'Too many new conversations. Please continue an existing conversation or try again later.',
 conversationsPerIpHour: 'Too many new conversations from this network. Please try again later.',
 conversationsPerProjectHour: 'This chat is very busy right now. Please try again later.',
 messagesPerContactHour: 'You have sent a lot of messages. Please wait before sending another.',
 messagesPerConversationMinute: 'You are sending messages too quickly. Please wait a moment and try again.',
 widgetEventsPerContactMinute: 'Too many chat updates. Please wait a moment.',
 uploadsPerContactDay: 'The daily attachment limit has been reached. Please try again tomorrow.',
 uploadBytesPerContactDay: 'The daily attachment size limit has been reached. Please try again tomorrow.',
 uploadsPerProjectDay: 'Attachments are unavailable for the rest of the day. Please try again tomorrow.',
 uploadBytesPerProjectDay: 'Attachments are unavailable for the rest of the day. Please try again tomorrow.',
 registrationsPerIpDay: 'Too many sign-ups from this network today. Please try again tomorrow.',
 projectsPerIpDay: 'Too many projects were created from this network today. Please try again tomorrow.',
 projectsPerAccountDay: 'This account has created too many projects today. Please try again tomorrow.',
}

/**
 * The client address Cloudflare's edge sets (clients cannot supply it in production).
 * IPv6 clients are grouped by /64, the smallest allocation one subscriber controls.
 * Without the header (local tooling), every caller shares one "unknown" bucket, which
 * keeps the limit in force instead of disabling it.
 */
export function clientAddress(headers: { header(name: string): string | undefined }) {
 const raw = headers.header('CF-Connecting-IP')?.trim().toLowerCase()
 if (!raw) return 'unknown'
 if (!raw.includes(':')) return raw
 const [head, tail = ''] = raw.split('::')
 const left = head ? head.split(':') : [], right = tail ? tail.split(':') : []
 const groups = raw.includes('::') ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right] : left
 return groups.slice(0, 4).map(group => group.replace(/^0+(?=.)/, '')).join(':') + '::/64'
}

export class RateLimitExceeded extends HTTPException {
 readonly limit: RateLimitName
 readonly retryAfter: number
 constructor(limit: RateLimitName, retryAfter: number) {
  const message = messages[limit]
  super(429, { message, res: Response.json({ error: message, code: 'rate_limited', limit, retryAfter }, { status: 429, headers: { 'Retry-After': String(retryAfter) } }) })
  this.limit = limit
  this.retryAfter = retryAfter
 }
}

/**
 * Take capacity from every listed limit, or none: when one refuses, capacity already
 * taken from the others is returned and a 429 carrying Retry-After is thrown.
 * One clock reading places every check and the Retry-After, so the delay always
 * counts to the end of the window that refused (at least one second, never zero).
 */
export async function enforceRateLimits(env: Env, checks: Array<[limit: RateLimitName, subject: string, amount?: number]>, now = Date.now()) {
 const limits = rateLimits(env), taken: Array<[CounterPosition, number]> = []
 for (const [limit, subject, amount = 1] of checks) {
  const result = await consumeCounter(env, { name: `rate:${limit}`, seconds: windows[limit] }, subject, limits[limit], amount, now)
  if (!result.allowed) {
   for (const [position, used] of taken) await refundCounter(env, position, used)
   throw new RateLimitExceeded(limit, Math.max(1, Math.ceil((result.expiresAt - now) / 1000)))
  }
  taken.push([result, amount])
 }
}

export async function enforceRateLimit(env: Env, limit: RateLimitName, subject: string, amount = 1) {
 await enforceRateLimits(env, [[limit, subject, amount]])
}
