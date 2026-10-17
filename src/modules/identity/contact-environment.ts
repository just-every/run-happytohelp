/** Browser-supplied preferences and request-observed context have separate sources.
 * These metadata keys are also the active fields historical import normalizes.
 * Never accept network/device claims from widget JSON or signed business metadata.
 */
export function contactEnvironment(request: Request, supplied: unknown) {
 const input = supplied && typeof supplied === 'object' ? supplied as Record<string, unknown> : {}
 const metadata: Record<string, string | number> = {last_seen_at: Date.now()}
 if (typeof input.timezone === 'string' && input.timezone.length <= 100) {
  try { metadata.timezone = new Intl.DateTimeFormat('en', {timeZone: input.timezone}).resolvedOptions().timeZone } catch {}
 }
 if (typeof input.language === 'string' && input.language.length <= 100) {
  try { const language = Intl.getCanonicalLocales(input.language)[0]; if (language) metadata.language = language } catch {}
 }
 const ip = request.headers.get('CF-Connecting-IP')?.trim()
 if (ip && ip.length <= 45 && (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip) || /^[a-f\d:.]+$/i.test(ip) && ip.includes(':'))) metadata.ip_address = ip
 const country = (request as Request & {cf?: {country?: unknown}}).cf?.country ?? request.headers.get('CF-IPCountry')
 if (typeof country === 'string' && /^[A-Z]{2}$/.test(country) && country !== 'XX') metadata.country_code = country
 const userAgent = request.headers.get('User-Agent')
 if (userAgent) metadata.user_agent = userAgent.slice(0, 2048)
 return metadata
}

// Business metadata is replaced on signed updates; collected and operator-owned
// fields survive replacement and cannot be introduced through business metadata.
export const retainedContactMetadata = [
 'provided_name', 'provided_email', 'provided_email_source', 'provided_email_set_by', 'provided_email_set_at', 'email_unproven', 'phone',
 'timezone', 'language', 'ip_address', 'country_code', 'user_agent', 'last_seen_at', 'widget_opened',
 'is_blocked', 'blocked_at', 'is_deleted', 'deleted_at', 'is_erasing', 'is_erased', 'erased_at',
]
