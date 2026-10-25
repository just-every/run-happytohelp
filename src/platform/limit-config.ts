import type { Env } from './env'

/**
 * Public request limits. Override any subset with the RATE_LIMITS JSON variable.
 * Per-address and per-visitor limits stop one client; the per-project ceilings bound what
 * many rotating client addresses can create in one project (sessions and their contacts,
 * conversations, attachments). They sit well above a busy site's real traffic.
 */
export const rateLimitDefaults = {
 apiRequestsPerTokenMinute: 120,
 outboundNoticesPerProjectMinute: 10,
 widgetSessionsPerIpHour: 30,
 widgetSessionsPerProjectHour: 5000,
 conversationsPerContactHour: 10,
 conversationsPerIpHour: 30,
 conversationsPerProjectHour: 5000,
 messagesPerContactHour: 120,
 messagesPerConversationMinute: 15,
 widgetEventsPerContactMinute: 120,
 uploadsPerContactDay: 30,
 uploadBytesPerContactDay: 100_000_000,
 uploadsPerProjectDay: 5000,
 uploadBytesPerProjectDay: 5_000_000_000,
 registrationsPerIpDay: 5,
 projectsPerIpDay: 10,
 projectsPerAccountDay: 10,
} as const

/** Daily ceilings on AI work that visitors can trigger. Override with AI_DAILY_CEILINGS. */
export const aiCeilingDefaults = {
 repliesPerProject: 200,
 spendUsdPerProject: 10,
 repliesPerInstallation: 2000,
 contextRunsPerProject: 500,
} as const

export type RateLimitName = keyof typeof rateLimitDefaults
export type AiCeilingName = keyof typeof aiCeilingDefaults

const parsed = new Map<string, Record<string, number>>()

function overrides(name: string, raw: unknown, defaults: Record<string, number>) {
 if (raw === undefined || raw === null || (typeof raw === 'string' && !raw.trim())) return defaults
 if (typeof raw !== 'string') throw new Error(`${name} must be a JSON object`)
 const cached = parsed.get(name + '\u0000' + raw)
 if (cached) return cached
 const value = JSON.parse(raw)
 if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error(`${name} must be a JSON object`)
 for (const [key, limit] of Object.entries(value)) {
  if (!(key in defaults)) throw new Error(`${name} has unknown limit ${key}`)
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) throw new Error(`${name}.${key} must be a positive number`)
  if (key !== 'spendUsdPerProject' && !Number.isSafeInteger(limit)) throw new Error(`${name}.${key} must be a positive integer`)
 }
 const result = { ...defaults, ...value }
 parsed.set(name + '\u0000' + raw, result)
 return result
}

/** Invalid configuration fails the request visibly instead of silently removing a limit. */
export function rateLimits(env: Env): Record<RateLimitName, number> {
 return overrides('RATE_LIMITS', env.RATE_LIMITS, rateLimitDefaults) as Record<RateLimitName, number>
}

export function aiCeilings(env: Env): Record<AiCeilingName, number> {
 return overrides('AI_DAILY_CEILINGS', env.AI_DAILY_CEILINGS, aiCeilingDefaults) as Record<AiCeilingName, number>
}
