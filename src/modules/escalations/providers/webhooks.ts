import { githubIssue } from './github'
import { jiraIssue } from './jira'
import { linearIssue } from './linear'
import { baseUrl } from './http'
import { record, text, type Issue, type Tracker } from './types'

export async function verifyWebhook(provider: Tracker, secret: string, headers: Headers, raw: string): Promise<boolean> {
  try {
    if (!secret || new TextEncoder().encode(raw).byteLength > 1_048_576) return false
    const header = headers.get(provider === 'github' ? 'x-hub-signature-256' : provider === 'jira' ? 'x-hub-signature' : 'linear-signature')
    const signature = provider === 'linear' ? header : header?.startsWith('sha256=') ? header.slice(7) : null
    if (!signature || !/^[a-f0-9]{64}$/i.test(signature)) return false
    const bytes = Uint8Array.from(signature.match(/../g)!, hex => parseInt(hex, 16))
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
    if (!await crypto.subtle.verify('HMAC', key, bytes, new TextEncoder().encode(raw))) return false
    if (provider === 'linear') {
      const timestamp = record(JSON.parse(raw)).webhookTimestamp
      if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > 60_000) return false
    }
    return true
  } catch { return false }
}

/** Call only after verification. Reconcile event identity using getIssue before applying state. */
export function parseWebhook(provider: Tracker, headers: Headers, payload: any): { issue: Issue; deliveryId: string } | null {
  try {
    const event = record(payload)
    if (provider === 'github') {
      if (headers.get('x-github-event') !== 'issues') return null
      return { issue: githubIssue(event.issue, text(record(event.repository).full_name)), deliveryId: text(headers.get('x-github-delivery')) }
    }
    if (provider === 'linear') {
      if (event.type !== 'Issue' || !['create', 'update'].includes(event.action)) return null
      return { issue: linearIssue(event.data, event.url), deliveryId: text(headers.get('linear-delivery')) }
    }
    if (!['jira:issue_created', 'jira:issue_updated'].includes(event.webhookEvent)) return null
    const issue = record(event.issue)
    // self supplies only a validated Jira site for display; it is never fetched.
    const self = new URL(text(issue.self))
    const origin = baseUrl({ provider: 'jira', token: '', target: '', baseUrl: self.origin })
    return { issue: jiraIssue(issue, origin), deliveryId: text(headers.get('x-atlassian-webhook-identifier')) }
  } catch { return null }
}
