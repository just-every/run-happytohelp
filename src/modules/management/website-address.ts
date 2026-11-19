import { HTTPException } from 'hono/http-exception'

/** Public addresses must be complete URLs; local HTTP is useful during installation. */
export function websiteAddress(value: unknown, label: string, originOnly = false, {allowStoredWildcard = false} = {}) {
  const invalid = () => new HTTPException(400, { message: `${label}: enter a complete HTTPS URL, or HTTP on localhost for local development` })
  if (typeof value !== 'string' || value.length > 2000) throw invalid()
  let address: URL
  try { address = new URL(value.trim()) } catch { throw invalid() }
  if (address.username || address.password || !address.hostname || (!allowStoredWildcard && address.hostname.includes('*')) ||
      (address.protocol !== 'https:' && !(address.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(address.hostname)))) throw invalid()
  if (originOnly && (address.pathname !== '/' || address.search || address.hash)) {
    throw new HTTPException(400, { message: `${label}: use only the scheme, hostname and optional port, without a path, query or fragment` })
  }
  return originOnly ? address.origin : address.href
}
