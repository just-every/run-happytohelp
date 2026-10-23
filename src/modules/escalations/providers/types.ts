export type Tracker = 'github' | 'linear' | 'jira'
export type Provider = Tracker | 'slack' | 'teams'

export interface Connection {
  provider: Provider
  token: string
  baseUrl?: string
  target: string
  webhookSecret?: string
}

export interface Issue {
  id: string
  key: string
  url: string
  status: string
  assignee: string | null
  closed: boolean
  updatedAt: number
}

export interface IssueInput { title: string; body: string }
export interface TicketLink { url: string; body: string }

// Errors deliberately carry neither provider bodies nor request credentials.
export function providerError(): Error {
  return new Error('Engineering provider request failed')
}

export function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 8192) throw providerError()
  return value
}

export function identity(value: unknown): string {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value)
  return text(value)
}

export function timestamp(value: unknown): number {
  const time = typeof value === 'string' ? Date.parse(value) : NaN
  if (!Number.isFinite(time)) throw providerError()
  return time
}

export function record(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw providerError()
  return value as Record<string, any>
}

export function comment(link: TicketLink): string {
  let url: URL
  try { url = new URL(link.url) } catch { throw providerError() }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw providerError()
  return `${link.body}\n\nSupport conversation: ${url.href}`
}
