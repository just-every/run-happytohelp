import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv,Env} from '../../platform/env'
import {decryptToken} from '../integrations/secrets'
import {contactAvailableSql} from '../conversations/contact-privacy'
import {mediaResponseHeaders} from '../conversations/media-response'
import {connection,digest,liveConnection,type Connection} from './model'
import {teamsToken,serviceUrl} from './teams'
import {boundedFetch,providerJson,safeUrl} from './network'
export interface Attachment {url?:string;id?:string;name?:string;type:string}
const types=new Set(['image/png','image/jpeg','image/gif','image/webp','application/pdf','text/plain','audio/mpeg','audio/ogg','audio/mp4','video/mp4'])
const cdn=(u:URL)=>u.hostname==='lookaside.fbsbx.com'||u.hostname.endsWith('.fbcdn.net')
export async function inboundMedia(env:Env,row:Connection,t:any,files:Attachment[]){
 if(files.length>5)throw new HTTPException(413,{message:'At most five channel attachments are supported'})
 const token=await decryptToken(env,row.project_id,row.token_cipher!),staged:{id:string;key:string}[]=[]
 try{for(const file of files){
  let url=file.url||'',headers:Record<string,string>={}
  if(row.provider==='sms'){
   url=safeUrl(url,u=>u.hostname==='api.twilio.com'&&u.pathname.startsWith('/2010-04-01/Accounts/'+row.account+'/Messages/'))
   headers.Authorization='Basic '+btoa(row.account+':'+token)
  }else if(row.provider==='whatsapp'){
   if(!file.id)throw new HTTPException(422,{message:'WhatsApp media ID missing'})
   const info=await providerJson('https://graph.facebook.com/v23.0/'+encodeURIComponent(file.id)+'?phone_number_id='+encodeURIComponent(row.sender),{headers:{Authorization:'Bearer '+token}})
   if(info.id!==file.id)throw new HTTPException(422,{message:'WhatsApp media identity mismatch'})
   url=safeUrl(info.url,cdn);headers.Authorization='Bearer '+token
  }else if(row.provider==='teams'){
   const base=new URL(serviceUrl(t.service_url));url=safeUrl(url,u=>u.origin===base.origin&&u.pathname.startsWith(base.pathname+'v3/attachments/'));headers.Authorization='Bearer '+await teamsToken(env,row)
  }else if(row.provider==='slack'){
   url=safeUrl(url,u=>u.hostname==='files.slack.com'&&u.pathname.startsWith('/files-pri/'));headers.Authorization='Bearer '+token
  }else url=safeUrl(url,cdn)
  let result=await boundedFetch(url,{headers},10000000)
  // Twilio's authenticated API redirects media to its CDN. Never forward the account credential there.
  if(row.provider==='sms'&&[301,302,303,307,308].includes(result.status))result=await boundedFetch(safeUrl(result.headers.get('location')||'',u=>u.hostname==='media.twiliocdn.com'||u.hostname.endsWith('.twiliocdn.com')),{},10000000)
  const type=(result.headers.get('content-type')||file.type).split(';')[0].trim().toLowerCase()
  if(result.status!==200||!types.has(type)||!result.data.length)throw new HTTPException(422,{message:'Unsupported or unavailable attachment; retain the provider event for review'})
  await connection(env,row.id)
  const id=crypto.randomUUID(),key=row.project_id+'/'+t.conversation_id+'/'+id;staged.push({id,key})
  await env.FILES.put(key,result.data,{httpMetadata:{contentType:type}})
  const saved=await env.DB.prepare(`INSERT INTO media SELECT ?,c.project_id,c.id,?,?,?,?,?,NULL,? FROM conversations c WHERE c.id=? AND c.project_id=? AND ${contactAvailableSql()} AND EXISTS(SELECT 1 FROM support_channel_connections WHERE id=? AND ${liveConnection}) AND NOT EXISTS(SELECT 1 FROM support_channel_fences WHERE connection_id=? AND identity_hash=?)`).bind(id,t.contact_id,key,(file.name||'channel-attachment').slice(0,200),type,result.data.length,Date.now(),t.conversation_id,row.project_id,row.id,row.id,t.identity_hash).run()
  if(!saved.meta.changes)throw new HTTPException(409,{message:'Attachment authority changed'})
 }
 return staged
 }catch(error){await discardMedia(env,staged);throw error}
}
export async function discardMedia(env:Env,staged:{id:string;key:string}[]){for(const file of staged){const linked=await env.DB.prepare('SELECT 1 FROM media WHERE id=? AND message_id IS NOT NULL').bind(file.id).first();if(!linked){await env.DB.prepare('DELETE FROM media WHERE id=? AND message_id IS NULL').bind(file.id).run();await env.FILES.delete(file.key)}}}
export async function outboundMedia(env:Env,t:any,messageId:string){
 const rows=await env.DB.prepare(`SELECT m.id,m.filename,m.content_type,m.size FROM media m WHERE m.project_id=? AND m.conversation_id=? AND m.message_id=? AND NOT EXISTS(SELECT 1 FROM conversation_note_media n WHERE n.media_id=m.id)`).bind(t.project_id,t.conversation_id,messageId).all<any>()
 if(rows.results.length>5||rows.results.some(f=>!types.has(f.content_type)||f.size>10000000))throw new HTTPException(422,{message:'Unsupported channel attachment'})
 if(!rows.results.length)return []
 const origin=String(env.APP_ORIGIN||'');if(!origin.startsWith('https://'))throw new HTTPException(409,{message:'An HTTPS app origin is required for channel attachments'})
 const result=[]
 for(const f of rows.results){const token=crypto.randomUUID()+crypto.randomUUID();await env.DB.prepare('INSERT INTO support_channel_attachment_grants VALUES(?,?,?,?,?,?,?)').bind(await digest(token),t.project_id,t.connection_id,t.conversation_id,messageId,f.id,Date.now()+3600000).run();result.push({...f,url:new URL('/api/support-channels/attachments/'+token,origin).href})}
 return result
}
export const attachmentRoutes=new Hono<AppEnv>()
attachmentRoutes.get('/attachments/:token',async c=>{
 const row=await c.env.DB.prepare(`SELECT m.object_key,m.filename,m.content_type FROM support_channel_attachment_grants g JOIN support_channel_connections x ON x.id=g.connection_id AND x.project_id=g.project_id JOIN conversations c ON c.id=g.conversation_id AND c.project_id=g.project_id JOIN media m ON m.id=g.media_id AND m.message_id=g.message_id AND m.project_id=g.project_id AND m.conversation_id=g.conversation_id JOIN support_channel_sends s ON s.message_id=g.message_id WHERE g.token_hash=? AND g.expires_at>? AND x.revoked_at IS NULL AND x.token_cipher IS NOT NULL AND (x.provider NOT IN ('slack','teams') OR EXISTS(SELECT 1 FROM support_channel_threads t WHERE t.connection_id=x.id AND t.conversation_id=c.id AND t.channel_id IN (SELECT value FROM json_each(x.channels_json)))) AND s.state IN ('sending','accepted','delivered','uncertain') AND ${contactAvailableSql()} AND NOT EXISTS(SELECT 1 FROM conversation_note_media n WHERE n.media_id=m.id) AND NOT EXISTS(SELECT 1 FROM project_settings p WHERE p.project_id=c.project_id AND json_extract(p.settings_json,'$.deleted_at') IS NOT NULL)`).bind(await digest(c.req.param('token')),Date.now()).first<any>()
 if(!row)throw new HTTPException(404);const object=await c.env.FILES.get(row.object_key);if(!object)throw new HTTPException(404)
 return new Response(object.body,{headers:{...mediaResponseHeaders(row.content_type,row.filename),'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}})
})
