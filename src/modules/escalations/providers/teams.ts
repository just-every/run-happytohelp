import { request } from './http'
import { providerError, record, text, type Connection } from './types'

/** Delegated Graph ChannelMessage.Send. Never accept a caller-supplied fetch URL. */
export async function postTeams(connection: Connection, input: { channel: string; body: string }): Promise<{ id: string; url: string }> {
  if (connection.provider !== 'teams' || !validTeamsTarget(input.channel)) throw providerError()
  if (!input.body.trim() || new TextEncoder().encode(input.body).byteLength > 28_000) throw providerError()
  const [team, channel] = input.channel.split('/')
  const result = record(await request(connection, `/v1.0/teams/${encodeURIComponent(team)}/channels/${encodeURIComponent(channel)}/messages`, {
    body: { contentType: 'text', content: input.body },
  }))
  const id = text(result.id)
  const url = new URL(text(result.webUrl))
  if (url.protocol !== 'https:' || url.hostname !== 'teams.microsoft.com' || url.port || url.username || url.password || !url.pathname.startsWith('/l/message/')) throw providerError()
  return { id, url: url.href }
}

export function validTeamsTarget(value: string): boolean {
  return /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/19:[A-Za-z0-9._-]+@thread\.(?:tacv2|skype)$/.test(value)
}
