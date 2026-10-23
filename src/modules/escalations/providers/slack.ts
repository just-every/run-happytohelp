import { request } from './http'
import { providerError, record, text, type Connection } from './types'

export async function postSlack(connection: Connection, input: { channel: string; body: string }): Promise<{ id: string; url: string }> {
  if (connection.provider !== 'slack' || !/^[A-Z0-9]+$/.test(input.channel)) throw providerError()
  if (!validSlackBody(input.body)) throw providerError()
  const body = escapeBody(input.body)
  // Slack otherwise truncates the selected context and can interpret mentions.
  const message = record(await request(connection, '/api/chat.postMessage', {
    channel: input.channel, text: body, mrkdwn: false, parse: 'none',
    link_names: false, unfurl_links: false, unfurl_media: false,
  }))
  if (message.ok !== true) throw providerError()
  const id = text(message.ts)
  const channel = text(message.channel)
  if (!/^\d+\.\d+$/.test(id) || !/^[A-Z0-9]+$/.test(channel)) throw providerError()
  const result = record(await request(connection, `/api/chat.getPermalink?channel=${encodeURIComponent(channel)}&message_ts=${encodeURIComponent(id)}`))
  if (result.ok !== true) throw providerError()
  let url: URL
  try { url = new URL(text(result.permalink)) } catch { throw providerError() }
  if (url.protocol !== 'https:' || !/^(?:[a-z0-9-]+\.)?slack\.com$/.test(url.hostname) || url.port || url.username || url.password) throw providerError()
  return { id, url: url.href }
}

const escapeBody = (body: string) => body.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
export function validSlackBody(body: string): boolean {
  return typeof body === 'string' && !!body.trim() && escapeBody(body).length <= 40_000
}
