// Static app-slot rules share the already linked Business stylesheet. The
// declared installer theme remains tokens/fonts only.
const workspaceCss = `.business-workspace { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; margin: 1rem 0; }
.business-workspace img { object-fit: contain; }
.business-workspace h2, .business-workspace p { margin: 0; }
.business-primary {
  display: inline-block;
  padding: .6rem 1rem;
  border-radius: var(--rer-radius, 12px);
  background: var(--rer-business-accent, var(--rer-accent, #334155));
  color: var(--rer-business-accent-text, var(--rer-accent-text, #fff));
  font-weight: 600;
}`

export async function workspaceStyles(request: Request, handle: (request: Request) => Promise<Response | null>): Promise<Response | null> {
  if (new URL(request.url).pathname !== '/rer-business.css') return handle(request)
  // Compose the app stylesheet before conditional handling, so a browser's
  // cached variables-only response cannot hide newly deployed static rules.
  const incoming = new Headers(request.headers)
  incoming.delete('if-none-match')
  const response = await handle(new Request(request, { headers: incoming }))
  if (response?.status !== 200) return response
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(workspaceCss))), byte => byte.toString(16).padStart(2, '0')).join('')
  const headers = new Headers(response.headers)
  const etag = `"${headers.get('etag')?.slice(1, -1)}-${digest}"`
  headers.set('etag', etag)
  if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers })
  return new Response(request.method === 'HEAD' ? null : `${workspaceCss}\n${await response.text()}`, { headers })
}
