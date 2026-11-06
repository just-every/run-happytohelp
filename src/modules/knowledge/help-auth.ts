import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../platform/env'
import {hashToken} from '../../platform/auth'
import {serverSecret} from '../../platform/db'
import {sendEmail,emailConfigured,emailOffMessage} from '../integrations/email'
import {linkOrigin} from '../identity/magic-link'
import {knowledgeRateLimit} from './feedback'
import {auditStatement} from '../audit/record'
import {activeSourceProjectSql} from './public-sources'
export const helpAuth=new Hono<AppEnv>()
export function safeHelpReturn(value:unknown,requestUrl:string,fallback:string){if(typeof value!=='string'||!value.startsWith('/')||value.startsWith('//')||/[\\\u0000-\u0020]/.test(value))return fallback;try{const url=new URL(value,requestUrl);return url.origin===new URL(requestUrl).origin?url.pathname+url.search:fallback}catch{return fallback}}
export function helpSameOrigin(request:Request){const origin=request.headers.get('Origin');if(origin&&origin!==new URL(request.url).origin)throw new HTTPException(403,{message:'Cross-origin request denied'})}
helpAuth.post('/public/:projectId/access/request',async c=>{
 helpSameOrigin(c.req.raw);c.header('Cache-Control','no-store')
 const projectId=c.req.param('projectId'),isForm=!(c.req.header('Content-Type')||'').includes('application/json'),body:any=isForm?await c.req.parseBody():await c.req.json(),email=typeof body.email==='string'?body.email.trim().toLowerCase():''
 if(email.length>320||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new HTTPException(400,{message:'Enter a valid email address'})
 const origin=linkOrigin(c.env);if(!origin||!emailConfigured(c.env))throw new HTTPException(503,{message:emailOffMessage})
 await knowledgeRateLimit(c.env,`access-ip:${projectId}:${c.req.header('CF-Connecting-IP')||'unknown'}`,30)
 await knowledgeRateLimit(c.env,`access-email:${projectId}:${email}`,5)
 const token=serverSecret(),hash=await hashToken(token),url=new URL(`/api/knowledge/public/${encodeURIComponent(projectId)}/access/verify`,origin)
 url.searchParams.set('token',token)
 await c.env.DB.batch([c.env.DB.prepare('DELETE FROM knowledge_help_links WHERE expires_at<?').bind(Date.now()),c.env.DB.prepare('DELETE FROM knowledge_help_sessions WHERE expires_at<?').bind(Date.now()),c.env.DB.prepare('INSERT INTO knowledge_help_links VALUES(?,?,?,?,NULL)').bind(hash,projectId,email,Date.now()+900000),auditStatement(c.env.DB,{projectId,category:'auth',action:'knowledge.access.requested',actor:{type:'system'},source:'api',detail:{method:'email_link'}})])
 try{await sendEmail(c.env,{projectId,to:email,subject:'Sign in to the help center',text:`Open this link within 15 minutes to sign in to the help center: ${url.href}\nIf you did not request this, ignore this email.`,idempotencyKey:`help-access:${hash}`})}catch(error){await c.env.DB.prepare('DELETE FROM knowledge_help_links WHERE token_hash=?').bind(hash).run();throw error}
 if(isForm){const base=safeHelpReturn(body.returnTo,c.req.url,`/help/${encodeURIComponent(projectId)}`),url=new URL(base,c.req.url);url.search='?access=signin&sent=1';return c.redirect(url.pathname+url.search,303)}
 return c.json({accepted:true},202)
})
helpAuth.get('/public/:projectId/access/verify',async c=>{
 c.header('Cache-Control','no-store');c.header('Referrer-Policy','no-referrer')
 const projectId=c.req.param('projectId'),token=c.req.query('token')||'';if(!/^[a-f0-9]{64}$/.test(token))throw new HTTPException(400,{message:'Invalid or expired sign-in link'})
 const hash=await hashToken(token),session=serverSecret(),sessionHash=await hashToken(session),now=Date.now()
 const result=await c.env.DB.batch([
 c.env.DB.prepare(`INSERT INTO knowledge_help_sessions SELECT ?,t.project_id,(SELECT c.id FROM contacts c WHERE c.project_id=t.project_id AND lower(trim(c.email))=t.email AND c.is_verified=1 AND lower(trim(c.external_id))=t.email AND coalesce(json_extract(c.metadata_json,'$.email_unproven'),0)<>1 AND coalesce(json_extract(c.metadata_json,'$.is_deleted'),0)<>1 AND NOT EXISTS(SELECT 1 FROM contact_erasures e WHERE e.project_id=c.project_id AND e.contact_id=c.id) ORDER BY c.is_verified DESC,c.created_at LIMIT 1),t.email,? FROM knowledge_help_links t WHERE t.token_hash=? AND t.project_id=? AND t.consumed_at IS NULL AND t.expires_at>? AND ${activeSourceProjectSql('t.project_id')} AND NOT EXISTS(SELECT 1 FROM contacts c WHERE c.project_id=t.project_id AND lower(trim(c.email))=t.email AND (coalesce(json_extract(c.metadata_json,'$.is_blocked'),0)=1 OR coalesce(json_extract(c.metadata_json,'$.is_deleted'),0)=1 OR EXISTS(SELECT 1 FROM contact_erasures e WHERE e.project_id=c.project_id AND e.contact_id=c.id))) RETURNING token_hash`).bind(sessionHash,now+86400000,hash,projectId,now),
 c.env.DB.prepare('UPDATE knowledge_help_links SET consumed_at=? WHERE token_hash=? AND consumed_at IS NULL AND EXISTS(SELECT 1 FROM knowledge_help_sessions WHERE token_hash=?) RETURNING token_hash').bind(now,hash,sessionHash)])
 if(!result[0].results.length||!result[1].results.length)throw new HTTPException(400,{message:'Invalid or expired sign-in link'})
 await auditStatement(c.env.DB,{projectId,category:'auth',action:'knowledge.access.verified',actor:{type:'system'},source:'api',detail:{method:'email_link'}}).run()
 c.header('Set-Cookie',`h2h_help=${session}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400${new URL(c.req.url).protocol==='https:'?'; Secure':''}`)
 return c.redirect(`/help/${encodeURIComponent(projectId)}`,303)
})
helpAuth.post('/public/:projectId/access/logout',async c=>{
 helpSameOrigin(c.req.raw);c.header('Cache-Control','no-store')
 const token=c.req.header('Cookie')?.match(/(?:^|;\s*)h2h_help=([^;]+)/)?.[1]
 if(token)await c.env.DB.prepare('DELETE FROM knowledge_help_sessions WHERE token_hash=? AND project_id=?').bind(await hashToken(token),c.req.param('projectId')).run()
 c.header('Set-Cookie','h2h_help=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0')
 const isForm=!(c.req.header('Content-Type')||'').includes('application/json'),body:any=isForm?await c.req.parseBody():{}
 return isForm?c.redirect(safeHelpReturn(body.returnTo,c.req.url,`/help/${encodeURIComponent(c.req.param('projectId'))}`),303):c.json({signedOut:true})
})
