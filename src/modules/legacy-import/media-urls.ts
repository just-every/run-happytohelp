/** Legacy storage URLs in imported text, and what they become.
 *
 * Legacy served every file from its public storage bucket: `https://storage.happytohelp.com/<key>` (the host is the
 * bucket's name), the bucket's own S3 hosts (`storage.happytohelp.com.s3[.<region>].amazonaws.com/<key>`,
 * `s3[.<region>].amazonaws.com/storage.happytohelp.com/<key>`), and `storage.happytohelp.co` the same way. `<key>` is the
 * file's legacy storage key, `<directory>/<filename>.<extension>` (scripts/legacy-export/attachments.mjs). A URL is
 * matched by its percent-decoded path; its query and fragment are dropped with it. Every other host (legacy's
 * cdn.happytohelp.com artwork, Gravatar, a customer's site) is not storage and is never touched. */

const direct=new Set(['storage.happytohelp.com','storage.happytohelp.co'])
const bucketHost=/^storage\.happytohelp\.com\.s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com$/
const pathHost=/^s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com$/
const bucketPath='/storage.happytohelp.com/'
/** An absolute http(s) URL up to the first character that cannot be part of one in text, Markdown or HTML. */
const candidate=/https?:\/\/[^\s<>"'`()[\]{}|\\^]+/gi
/** Every legacy storage URL contains the bucket's name: the one substring a bounded read (LIKE) looks for. */
export const STORAGE_MARK='storage.happytohelp.co'

/** The legacy storage key a URL names: a string (possibly unknown to the index), null when the URL is not legacy storage,
 * '' when it is storage but names no key (a bare host, an undecodable path). */
export function legacyStorageKey(value:string):string|null{
 let url:URL
 try{url=new URL(value)}catch{return null}
 if(url.protocol!=='https:'&&url.protocol!=='http:'||url.username||url.password||url.port)return null
 const host=url.hostname.toLowerCase()
 let path:string
 if(direct.has(host)||bucketHost.test(host))path=url.pathname.slice(1)
 else if(pathHost.test(host)&&url.pathname.startsWith(bucketPath))path=url.pathname.slice(bucketPath.length)
 else return null
 try{return decodeURIComponent(path)}catch{return ''}
}

export interface UrlCounts {rewritten:number;left:number}
/** Replace each legacy storage URL in `text` whose key `resolve` knows by the native URL it gives; leave every other
 * character as it is. A URL `resolve` does not know stays exactly as written and is counted as left. Trailing sentence
 * punctuation that is not part of a known key stays outside the URL, as a Markdown autolink reads it. Only the native URL
 * takes the legacy URL's place; the renderers link a bare one when they show it (file-links.js). */
export function rewriteText(text:string,resolve:(key:string)=>string|undefined,counts:UrlCounts):string{
 if(!text.includes(STORAGE_MARK))return text
 return text.replace(candidate,(match:string)=>{
  const tries=[match]
  for(let url=match;/[.,;:!?]$/.test(url);)tries.push(url=url.slice(0,-1))
  let storage=false
  for(const url of tries){
   const key=legacyStorageKey(url)
   if(key===null)continue
   storage=true
   const native=key?resolve(key):undefined
   if(native){counts.rewritten++;return native+match.slice(url.length)}
  }
  if(storage)counts.left++
  return match
 })
}
