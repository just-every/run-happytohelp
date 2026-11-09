import type { Context } from 'hono'
import { escapeHtml as e } from './html'
import { busyFrame, busyPageHeaders } from './busy-page'

type Posted = string | File
const formTypes = ['application/x-www-form-urlencoded', 'multipart/form-data']
/** The typed fields of the public forms (help and portal sign-in, "Was this helpful?", portal reply, the survey) shown for
 * editing again; every other posted field (returnTo, locale, localId, expectedRevision, choices) is carried unchanged. */
const typed: Record<string, { label: string; email?: boolean }> = { email: { label: 'Email address', email: true }, content: { label: 'Message' }, message: { label: 'Message' }, comment: { label: 'Comment' } }
/** A chosen submit button, shown as the answer that is sent again. */
const chosen: Record<string, { label: string; values: Record<string, string> }> = { helpful: { label: 'Was this helpful?', values: { true: 'Yes', false: 'No' } } }

/** A browser's own native form post (not a script's fetch), which navigates to whatever this request answers. */
export function nativeFormPost(request: Request) {
 const type = request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() || '', mode = request.headers.get('Sec-Fetch-Mode')
 return !['GET', 'HEAD'].includes(request.method) && formTypes.includes(type) && Boolean(request.headers.get('Accept')?.includes('text/html')) && (!mode || mode === 'navigate')
}

function field(name: string, value: Posted, index: number) {
 const id = `busy-field-${index}`
 if (value instanceof File) {
  const picked = value.size > 0 || value.name !== ''
  return `<label for="${id}">Attachment (optional)</label><input id="${id}" type="file" name="${e(name)}"${picked ? ` aria-describedby="${id}-hint"><p class="help-center-busy-hint" id="${id}-hint">A file can’t be kept: choose ${value.name ? `“${e(value.name)}”` : 'your file'} again.</p>` : '>'}`
 }
 const control = typed[name]
 if (control) return control.email
  ? `<label for="${id}">${control.label}</label><input id="${id}" type="email" name="${e(name)}" value="${e(value)}" autocomplete="email" maxlength="320">`
  // The newline after <textarea> is dropped by the parser, so a value that starts with one keeps it.
  : `<label for="${id}">${control.label}</label><textarea id="${id}" name="${e(name)}" rows="5">\n${e(value)}</textarea>`
 const answer = chosen[name]?.values[value]
 return `<input type="hidden" name="${e(name)}" value="${e(value)}">${answer ? `<p class="help-center-busy-choice">${chosen[name].label} <strong>${answer}</strong></p>` : ''}`
}

/** The posted form again, same action, method and encoding, for the visitor to send when D1 has room. It never posts by itself. */
export function busyFormPage(action: string, multipart: boolean, fields: Record<string, Posted | Posted[]> | undefined) {
 const intro = '<h1>We couldn’t send this yet</h1><p class="help-center-notice">Many requests are arriving at once. '
 if (!fields) return busyFrame('Not sent yet', `${intro}Go back to the form and send it again in a few seconds.</p>`)
 let index = 0
 const controls = Object.entries(fields).flatMap(([name, value]) => (Array.isArray(value) ? value.map(item => field(name, item, index++)) : field(name, value, index++))).join('')
 return busyFrame('Not sent yet', `${intro}Your entries are below: send them again in a few seconds.</p><form class="help-center-busy-form" method="post" action="${e(action)}"${multipart ? ' enctype="multipart/form-data"' : ''}>${controls}<button type="submit">Send again</button></form>`)
}

/** The strictest of the public form routes' own same-origin proofs (portalSameOrigin, helpSameOrigin, sign-out): this site's
 * Origin, or no Origin and this site's Referer, and never a Sec-Fetch-Site other than same-origin. An overload can refuse a
 * post before its route's check runs (a cross-origin /api/* request reads D1 for CORS first), so only a post that passes
 * this gets its fields back in a form; any other gets the busy page without one. */
function sameOriginPost(request: Request) {
 const expected = new URL(request.url).origin, origin = request.headers.get('Origin'), referer = request.headers.get('Referer'), site = request.headers.get('Sec-Fetch-Site')
 if (site && site !== 'same-origin') return false
 if (origin) return origin === expected
 try { return Boolean(referer) && new URL(referer!).origin === expected } catch { return false }
}

/** app.onError's answer to a native form post that met D1's overload: for a same-origin post, the form page, read before the
 * refusal drains the body (Hono keeps a body a handler already parsed); for any other, the busy page without a form or any
 * posted field. Every request that is not a native form post keeps the JSON answer. */
export async function busyFormResponse(c: Context, retryAfter: number) {
 const request = c.req.raw
 if (!nativeFormPost(request)) return
 if (!sameOriginPost(request)) return c.html(busyFormPage('', false, undefined), 503, busyPageHeaders(retryAfter, 'same-origin'))
 const fields = await c.req.parseBody({ all: true }).catch(() => undefined), url = new URL(request.url)
 const multipart = request.headers.get('Content-Type')!.toLowerCase().startsWith('multipart/form-data')
 return c.html(busyFormPage(url.pathname + url.search, multipart, fields as Record<string, Posted | Posted[]> | undefined), 503, busyPageHeaders(retryAfter, 'same-origin'))
}
