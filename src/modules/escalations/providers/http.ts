import { providerError, type Connection } from './types'

const origins = {
  github: 'https://api.github.com',
  linear: 'https://api.linear.app',
  slack: 'https://slack.com',
  teams: 'https://graph.microsoft.com',
}

export function baseUrl(connection: Connection): string {
  try {
    const configured = connection.baseUrl || (connection.provider === 'jira' ? '' : origins[connection.provider])
    const url = new URL(configured)
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw providerError()
    const loopback = url.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)
    const allowed = connection.provider === 'jira'
      ? url.protocol === 'https:' && !url.port && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.atlassian\.net$/.test(url.hostname)
      : url.origin === origins[connection.provider]
    if (!loopback && !allowed) throw providerError()
    return url.origin
  } catch { throw providerError() }
}

function authorization(connection: Connection): string {
  const token = connection.token
  if (!token || token.length > 16384 || /[\r\n]/.test(token)) throw providerError()
  if (connection.provider === 'jira') {
    if (!/^(Basic|Bearer) [^\s]+$/.test(token)) throw providerError()
    return token
  }
  if (connection.provider === 'linear') return token
  return /^Bearer /i.test(token) ? token : `Bearer ${token}`
}

/** The edition's ordinary HTTPS transport: no redirects, retries or returned-URL fetches. */
export async function request(connection: Connection, path: string, body?: unknown): Promise<any> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    if (!path.startsWith('/') || path.startsWith('//')) throw providerError()
    const encoded = body === undefined ? undefined : JSON.stringify(body)
    if (encoded !== undefined && new TextEncoder().encode(encoded).byteLength > 1_048_576) throw providerError()
    const response = await fetch(`${baseUrl(connection)}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Authorization: authorization(connection),
        Accept: connection.provider === 'github' ? 'application/vnd.github+json' : 'application/json',
        ...(encoded === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(connection.provider === 'github' ? { 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'HappyToHelp' } : {}),
      },
      body: encoded,
      redirect: 'manual',
      signal: controller.signal,
    })
    if (!response.ok) {
      await response.body?.cancel()
      throw providerError()
    }
    const length = response.headers.get('content-length')
    if (length && (!/^\d+$/.test(length) || Number(length) > 65_536)) {
      await response.body?.cancel()
      throw providerError()
    }
    const reader = response.body?.getReader()
    if (!reader) throw providerError()
    const chunks: Uint8Array[] = []
    let size = 0
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      size += next.value.byteLength
      if (size > 65_536) { await reader.cancel(); throw providerError() }
      chunks.push(next.value)
    }
    const data = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data))
  } catch { throw providerError() }
  finally { clearTimeout(timeout) }
}
