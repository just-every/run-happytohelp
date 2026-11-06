/** The same cleaning as scripts/pack-zendesk-offline.mjs, applied to records read
 * from the API: attachment download URLs are dropped, an attachment path token in
 * any text is removed, and user info, query and fragment are stripped from URLs.
 * A ticket with inline images or attachments therefore imports, with attachment
 * metadata kept as an explicit omission. */
const DOWNLOAD_KEY=/(?:^|_)(?:content_url|download_url|original_url)$/i
const PATH_TOKEN=/(\/attachments\/token\/)[^/?#\s"'<>]+/gi
export interface Cleaning {redacted:number}
export function sanitize(value:unknown,cleaning:Cleaning):unknown{
 if(typeof value==='string'){
  let text=value.replace(PATH_TOKEN,(_,prefix:string)=>{cleaning.redacted++;return prefix+'removed'})
  if(/^https?:\/\//i.test(text)){try{const url=new URL(text);if(url.username||url.password||url.search||url.hash){url.username='';url.password='';url.search='';url.hash='';cleaning.redacted++;text=url.href}}catch{}}
  return text
 }
 if(Array.isArray(value))return value.map(item=>sanitize(item,cleaning))
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).flatMap(([key,child])=>{if(DOWNLOAD_KEY.test(key)&&typeof child==='string'&&/^(?:https?:\/\/|\/)/i.test(child)){cleaning.redacted++;return []}return [[key,sanitize(child,cleaning)]]}))
 return value
}
/** A person's sign-in and edit clocks change without any change to who they are.
 * Leaving them out keeps one source version for an unchanged person across pulls. */
export function stableUser(user:Record<string,unknown>){const {updated_at:_u,last_login_at:_l,...rest}=user;return rest}
