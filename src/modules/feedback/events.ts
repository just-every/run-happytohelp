import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../platform/env'
import {hashToken} from '../../platform/auth'
import {decryptToken} from '../integrations/secrets'
import {auditStatement} from '../audit/record'
import {contactAvailableSql} from '../conversations/contact-privacy'
import {publishActivity} from '../conversations/activity'
import {link,text} from './access'

async function boundedBody(request:Request){const reader=request.body?.getReader();if(!reader)throw new HTTPException(400);let data='',size=0;const decoder=new TextDecoder('utf-8',{fatal:true});for(;;){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>32768){await reader.cancel();throw new HTTPException(413)}data+=decoder.decode(next.value,{stream:true})}return data+decoder.decode()}
export const events=new Hono<AppEnv>()
events.post('/releases/:projectId',async c=>{
 const projectId=c.req.param('projectId'),raw=await boundedBody(c.req.raw)
 const row=await c.env.DB.prepare('SELECT secret_cipher FROM feedback_connections WHERE project_id=?').bind(projectId).first<{secret_cipher:string|null}>()
 if(!row?.secret_cipher)throw new HTTPException(401)
 const secret=await decryptToken(c.env,projectId,row.secret_cipher),key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']),signature=c.req.header('X-HappyToHelp-Signature')||''
 if(!/^[a-f0-9]{64}$/i.test(signature)||!await crypto.subtle.verify('HMAC',key,Uint8Array.from(signature.match(/../g)!,s=>parseInt(s,16)),new TextEncoder().encode(raw)))throw new HTTPException(401,{message:'Invalid release signature'})
 let body:any;try{body=JSON.parse(raw)}catch{throw new HTTPException(400)}
 const externalId=text(body.id,'release event id',200),issue=link(body.issue_url),release=link(body.release_url),at=Date.parse(body.released_at)
 if(!Number.isSafeInteger(at)||at>Date.now()+300000)throw new HTTPException(400,{message:'Invalid release time'})
 const digest=await hashToken(raw),id=crypto.randomUUID(),now=Date.now(),db=c.env.DB
 const prior=await db.prepare('SELECT digest FROM feedback_release_events WHERE project_id=? AND external_id=?').bind(projectId,externalId).first<{digest:string}>()
 if(prior){if(prior.digest!==digest)throw new HTTPException(409,{message:'Release event id already has a different payload'});return c.json({duplicate:true})}
 const receipt=`EXISTS(SELECT 1 FROM feedback_release_events WHERE id=? AND project_id=?)`
 const result=await db.batch([
 db.prepare('INSERT OR IGNORE INTO feedback_release_events VALUES(?,?,?,?,?,?,?,?)').bind(id,projectId,externalId,digest,issue,release,at,now),
 db.prepare(`INSERT OR IGNORE INTO feedback_updates(id,project_id,source_id,release_id,content,created_at) SELECT lower(hex(randomblob(16))),s.project_id,s.id,?,?,? FROM feedback_sources s JOIN conversations c ON c.id=s.conversation_id AND c.project_id=s.project_id WHERE s.project_id=? AND s.issue_url=? AND s.subscribed=1 AND ${contactAvailableSql()} AND ${receipt}`).bind(id,`A linked feature or fix has shipped: ${release}\nPlease try your original request again and tell us whether it works. We have not yet confirmed your recovery.`,now,projectId,issue,id,projectId),
 auditStatement(db,{projectId,category:'integration',action:'feedback.release_received',actor:{type:'system'},source:'system',target:{type:'feedback_release',id}},now,{sql:receipt,params:[id,projectId]}),
 ])
 const stored=await db.prepare('SELECT digest FROM feedback_release_events WHERE project_id=? AND external_id=?').bind(projectId,externalId).first<{digest:string}>()
 if(stored?.digest!==digest)throw new HTTPException(409,{message:'Release event id already has a different payload'})
 const affected=await db.prepare('SELECT DISTINCT conversation_id FROM feedback_sources WHERE project_id=? AND issue_url=?').bind(projectId,issue).all<{conversation_id:string}>()
 await Promise.all(affected.results.map(x=>publishActivity(c.env,projectId,x.conversation_id,'feedback')))
 return c.json({received:true,duplicate:!result[0].meta.changes,updates:result[1].meta.changes})
})
