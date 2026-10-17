import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../platform/env'
import {hashToken} from '../../platform/auth'
import {serverSecret} from '../../platform/db'
import {sendEmail,emailConfigured} from '../integrations/email'
import {linkOrigin} from '../identity/magic-link'
import {knowledgeRateLimit} from '../knowledge/feedback'
import {activeSourceProjectSql} from '../knowledge/public-sources'
import {auditStatement} from '../audit/record'
import {livePortalContact,portalCookie,resolvePortalActor} from './identity'
import {portalSameOrigin,portalReturnPath,portalBody,isPortalForm} from './security'

export const portalAccess=new Hono<AppEnv>()
// A typed widget address and imported address alone are never identity proof.
const provenContact=`coalesce(json_extract(ct.metadata_json,'$.email_unproven'),0)!=1 AND coalesce(json_extract(ct.metadata_json,'$.unverified_sender'),0)!=1 AND coalesce(json_extract(ct.metadata_json,'$.unusable_from'),0)!=1 AND (ct.is_verified=1 AND lower(trim(ct.external_id))=lower(trim(ct.email)) OR EXISTS(SELECT 1 FROM inbound_emails receipt JOIN messages message ON message.id=receipt.message_id AND message.project_id=receipt.project_id WHERE receipt.project_id=ct.project_id AND message.actor_role='contact' AND message.actor_id=ct.id AND json_extract(receipt.evidence_json,'$.sender_verified')=1 AND lower(trim(CASE WHEN instr(json_extract(receipt.evidence_json,'$.header_from'),'<')>0 THEN substr(json_extract(receipt.evidence_json,'$.header_from'),instr(json_extract(receipt.evidence_json,'$.header_from'),'<')+1,instr(json_extract(receipt.evidence_json,'$.header_from'),'>')-instr(json_extract(receipt.evidence_json,'$.header_from'),'<')-1) ELSE json_extract(receipt.evidence_json,'$.header_from') END))=lower(trim(ct.email))))`
portalAccess.post('/:projectId/access/request',async c=>{
 portalSameOrigin(c.req.raw)
 const projectId=c.req.param('projectId'),body=await portalBody(c),email=typeof body.email==='string'?body.email.trim().toLowerCase():''
 if(email.length>320||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new HTTPException(400,{message:'Enter a valid email address'})
 const origin=linkOrigin(c.env)
 if(!origin||!emailConfigured(c.env))throw new HTTPException(503,{message:'Email sign-in is not configured'})
 await knowledgeRateLimit(c.env,`portal-ip:${projectId}:${c.req.header('CF-Connecting-IP')||'unknown'}`,30)
 await knowledgeRateLimit(c.env,`portal-email:${projectId}:${email}`,5)
 const aliases=(await c.env.DB.prepare('SELECT slug FROM public_project_aliases WHERE project_id=?').bind(projectId).all<{slug:string}>()).results.map(row=>row.slug)
 const token=serverSecret(),hash=await hashToken(token),now=Date.now(),returnPath=portalReturnPath(body.returnTo,projectId,aliases)
 await c.env.DB.batch([c.env.DB.prepare('DELETE FROM portal_links WHERE expires_at<?').bind(now),c.env.DB.prepare('DELETE FROM portal_session_proofs WHERE expires_at<?').bind(now)])
 const result=await c.env.DB.prepare(`INSERT INTO portal_links(token_hash,project_id,email,return_path,expires_at) SELECT ?,id,?,?,? FROM projects WHERE id=? AND ${activeSourceProjectSql('projects.id')}`).bind(hash,email,returnPath,now+900000,projectId).run()
 if(result.meta.changes){
  const url=new URL(`/api/portal/${encodeURIComponent(projectId)}/access/verify`,origin);url.searchParams.set('token',token)
  try{await sendEmail(c.env,{projectId,to:email,subject:'Sign in to your support requests',text:`Open this link within 15 minutes to view your support requests: ${url.href}\nIf you did not request this, ignore this email.`,idempotencyKey:`portal-access:${hash}`})}catch(error){await c.env.DB.prepare('DELETE FROM portal_links WHERE token_hash=?').bind(hash).run();throw error}
  await auditStatement(c.env.DB,{projectId,category:'auth',action:'portal.access.requested',actor:{type:'system'},source:'api',detail:{method:'email_link'}}).run()
 }
 return isPortalForm(c)?c.redirect(`/portal/${encodeURIComponent(projectId)}?sent=1`,303):c.json({accepted:true},202)
})
portalAccess.get('/:projectId/access/verify',async c=>{
 const projectId=c.req.param('projectId'),token=c.req.query('token')||''
 if(!/^[a-f0-9]{64}$/.test(token))throw new HTTPException(400,{message:'Invalid or expired sign-in link'})
 const hash=await hashToken(token),session=serverSecret(),sessionHash=await hashToken(session),now=Date.now(),newContact=crypto.randomUUID()
 const eligibleLink=`t.token_hash=? AND t.project_id=? AND t.consumed_at IS NULL AND t.expires_at>? AND ${activeSourceProjectSql('t.project_id')}`
 // All steps run in one D1 transaction. Consumption follows the guarded session
 // insert, so concurrent clicks cannot mint a second session or revive history.
 const results=await c.env.DB.batch<any>([
  c.env.DB.prepare(`INSERT INTO contacts(id,project_id,email,external_id,is_verified,metadata_json,created_at) SELECT ?,t.project_id,t.email,?,1,'{"email_link_verified":1}',? FROM portal_links t WHERE ${eligibleLink} AND NOT EXISTS(SELECT 1 FROM portal_identities i WHERE i.project_id=t.project_id AND i.email=t.email) AND NOT EXISTS(SELECT 1 FROM contacts ct WHERE ct.project_id=t.project_id AND lower(trim(ct.email))=t.email AND ${provenContact})`).bind(newContact,'portal:'+newContact,now,hash,projectId,now),
  c.env.DB.prepare(`INSERT OR IGNORE INTO portal_identities(project_id,email,contact_id,verified_at) SELECT t.project_id,t.email,COALESCE((SELECT ct.id FROM contacts ct WHERE ct.project_id=t.project_id AND lower(trim(ct.email))=t.email AND ${provenContact} ORDER BY ct.created_at,ct.id LIMIT 1),(SELECT ct.id FROM contacts ct WHERE ct.id=? AND ct.project_id=t.project_id)),? FROM portal_links t WHERE ${eligibleLink} AND (EXISTS(SELECT 1 FROM contacts ct WHERE ct.id=? AND ct.project_id=t.project_id) OR EXISTS(SELECT 1 FROM contacts ct WHERE ct.project_id=t.project_id AND lower(trim(ct.email))=t.email AND ${provenContact}))`).bind(newContact,now,hash,projectId,now,newContact),
  c.env.DB.prepare(`INSERT INTO sessions(token_hash,actor_id,project_id,role,contact_id,expires_at) SELECT ?,i.contact_id,i.project_id,'contact',i.contact_id,? FROM portal_links t JOIN portal_identities i ON i.project_id=t.project_id AND i.email=t.email JOIN contacts ct ON ct.id=i.contact_id AND ct.project_id=i.project_id WHERE ${eligibleLink} AND lower(trim(ct.email))=i.email AND ${livePortalContact()}`).bind(sessionHash,now+86400000,hash,projectId,now),
  c.env.DB.prepare(`INSERT INTO portal_session_proofs SELECT s.token_hash,s.project_id,s.contact_id,i.email,s.expires_at FROM sessions s JOIN portal_identities i ON i.project_id=s.project_id AND i.contact_id=s.contact_id WHERE s.token_hash=?`).bind(sessionHash),
  c.env.DB.prepare('UPDATE portal_links SET consumed_at=? WHERE token_hash=? AND consumed_at IS NULL AND EXISTS(SELECT 1 FROM portal_session_proofs WHERE token_hash=?) RETURNING return_path').bind(now,hash,sessionHash)
 ])
 const link=results[4].results[0]
 if(!link)throw new HTTPException(400,{message:'Invalid or expired sign-in link'})
 await auditStatement(c.env.DB,{projectId,category:'auth',action:'portal.access.verified',actor:{type:'system'},source:'api',detail:{method:'email_link'}}).run()
 c.header('Set-Cookie',portalCookie(session,c.req.url))
 const aliases=(await c.env.DB.prepare('SELECT slug FROM public_project_aliases WHERE project_id=?').bind(projectId).all<{slug:string}>()).results.map(row=>row.slug)
 return c.redirect(portalReturnPath(link.return_path,projectId,aliases),303)
})
portalAccess.post('/:projectId/access/logout',async c=>{
 portalSameOrigin(c.req.raw)
 const projectId=c.req.param('projectId'),identity=await resolvePortalActor(c.env,projectId,c.req.raw)
 if(identity)await c.env.DB.batch([c.env.DB.prepare('UPDATE sessions SET revoked_at=? WHERE token_hash=? AND project_id=?').bind(Date.now(),identity.sessionHash,projectId),c.env.DB.prepare('DELETE FROM portal_session_proofs WHERE token_hash=? AND project_id=?').bind(identity.sessionHash,projectId),auditStatement(c.env.DB,{projectId,category:'auth',action:'portal.access.signed_out',actor:{type:'system'},source:'api'})])
 c.header('Set-Cookie',portalCookie('',c.req.url,0))
 return isPortalForm(c)?c.redirect(`/portal/${encodeURIComponent(projectId)}`,303):c.json({signedOut:true})
})
