// A small tolerant HTML reader. It never executes or fetches anything; it only turns markup into text and facts.

const NAMED: Record<string, string> = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '-', mdash: '-', rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', hellip: '...', copy: '(c)', middot: '.', bull: '-'}

export function decodeEntities(text: string): string {
 return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
  if (body[0] === '#') {
   const code = body[1].toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
   return Number.isInteger(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ' '
  }
  const name = body.toLowerCase()
  return Object.hasOwn(NAMED, name) ? NAMED[name] : whole
 })
}

const squash = (text: string) => decodeEntities(text).replace(/\s+/g, ' ').trim()

export function attributes(source: string): Record<string, string> {
 const found: Record<string, string> = Object.create(null)
 for (const match of source.matchAll(/([^\s=/"'<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
  const name = match[1].toLowerCase()
  if (!(name in found)) found[name] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '')
 }
 return found
}

export interface Tag {name: string; attrs: Record<string, string>}

/** Every opening tag of one name, in document order. */
export function tagsNamed(html: string, name: string): Tag[] {
 const out: Tag[] = []
 for (const match of html.matchAll(new RegExp(`<${name}(?=[\\s/>])((?:[^>"']|"[^"]*"|'[^']*')*)>`, 'gi'))) out.push({name, attrs: attributes(match[1])})
 return out
}

export function titleOf(html: string): string {
 const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
 return match ? squash(match[1].replace(/<[^>]*>/g, '')) : ''
}

export function metaContent(html: string, key: 'name' | 'property', value: string): string {
 for (const tag of tagsNamed(html, 'meta')) if (tag.attrs[key]?.toLowerCase() === value && tag.attrs.content) return squash(tag.attrs.content)
 return ''
}

export interface Anchor {href: string; text: string}

export function anchors(html: string): Anchor[] {
 const out: Anchor[] = []
 for (const match of html.matchAll(/<a(?=[\s/>])((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/a\s*>/gi)) {
  const href = attributes(match[1]).href
  if (href) out.push({href, text: squash(match[2].replace(/<[^>]*>/g, ' '))})
 }
 return out
}

const DROP_BLOCKS = /<(script|style|noscript|svg|template|iframe|head|select|textarea|object|canvas)(?=[\s/>])[\s\S]*?<\/\1\s*>/gi
const CHROME = new Set(['nav', 'header', 'footer', 'aside', 'form', 'button', 'dialog'])
const BLOCK = new Set(['p', 'div', 'section', 'article', 'main', 'ul', 'ol', 'li', 'table', 'tr', 'blockquote', 'pre', 'dl', 'dt', 'dd', 'figure', 'figcaption', 'br', 'hr'])

export interface Extracted {heading: string; text: string}

/** The readable body as light Markdown: the first h1 apart, then headings, list items and paragraphs. Navigation, headers, footers and forms are dropped. */
export function extractReadable(html: string): Extracted {
 let body = html.replace(/<!--[\s\S]*?-->/g, '').replace(DROP_BLOCKS, ' ')
 const main = /<main(?=[\s/>])[\s\S]*<\/main\s*>/i.exec(body) ?? /<article(?=[\s/>])[\s\S]*<\/article\s*>/i.exec(body)
 if (main) body = main[0]
 const lines: string[] = []
 let current = '', chrome = 0, heading = ''
 const take = () => {
  const text = squash(current)
  current = ''
  return text === '-' ? '' : text
 }
 const flush = () => {
  const text = take()
  if (text) lines.push(text)
 }
 for (const token of body.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)|</g)) {
  if (token[4] !== undefined) {
   if (!chrome) current += token[4]
   continue
  }
  if (!token[2]) continue
  const name = token[2].toLowerCase(), closing = token[1] === '/'
  if (CHROME.has(name)) {
   flush()
   if (closing) chrome = Math.max(0, chrome - 1)
   else if (!token[3].trimEnd().endsWith('/')) chrome++
   continue
  }
  if (chrome) continue
  const level = /^h([1-6])$/.exec(name)?.[1]
  if (level) {
   if (!closing) {
    flush()
    continue
   }
   const text = take()
   if (!text) continue
   if (level === '1' && !heading) heading = text
   else lines.push(`${'#'.repeat(Math.max(2, Number(level)))} ${text}`)
   continue
  }
  if (name === 'li' && !closing) {
   flush()
   current = '- '
   continue
  }
  if (BLOCK.has(name)) flush()
 }
 flush()
 return {heading, text: lines.join('\n\n')}
}
