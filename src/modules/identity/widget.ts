import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { AppEnv } from '../../platform/env'
import { hashToken } from '../../platform/auth'
import { id,requiredString } from '../../platform/db'
import {mailboxProofSql} from './mailbox'
import {contactWritable} from '../../platform/contact-state'
import { clientAddress,enforceRateLimits } from '../../platform/rate-limits'
import {updateSignedWidgetMetadata} from './widget-metadata'
import {contactEnvironment} from './contact-environment'
async function verify(secret:string,value:string,signature:string){if(!/^[a-f0-9]{64}$/i.test(signature))return false;const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);return crypto.subtle.verify('HMAC',key,Uint8Array.from(signature.match(/../g)!,x=>parseInt(x,16)),new TextEncoder().encode(value))}
export const widget=new Hono<AppEnv>()
widget.post('/widget/session',async c=>{
 const b=await c.req.json();const project=await c.env.DB.prepare("SELECT id,allowed_origin,verification_secret FROM projects WHERE widget_key=? AND NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=projects.id AND json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL)").bind(requiredString(b.widgetKey,'widgetKey')).first<{id:string;allowed_origin:string;verification_secret:string|null}>();if(!project)throw new HTTPException(403);if((c.req.header('Origin')||new URL(c.req.url).origin)!==project.allowed_origin&&(c.req.header('Origin')||new URL(c.req.url).origin)!==new URL(c.req.url).origin){if(!b.previewToken||c.req.header('Origin')!==c.env.PREVIEW_ORIGIN||!await c.env.DB.prepare('SELECT 1 FROM preview_grants g WHERE g.public_demo=0 AND EXISTS(SELECT 1 FROM memberships m WHERE m.project_id=g.project_id AND m.user_id=g.actor_id) AND g.token_hash=? AND g.project_id=? AND g.expires_at>? AND g.remaining_requests>0').bind(await hashToken(b.previewToken),project.id,Date.now()).first())throw new HTTPException(403)}
 // Origin is client-supplied outside browsers, so admission is also bounded per widget key and client address,
 // and per project so rotating addresses cannot create unbounded sessions and contacts.
 await enforceRateLimits(c.env,[['widgetSessionsPerIpHour',`${project.id}|${clientAddress(c.req)}`],['widgetSessionsPerProjectHour',project.id]])
 const identifier=typeof b.identifier==='string'?b.identifier:typeof b.email==='string'?b.email:null;let verified=false
 if(b.contact_hash){if(!project.verification_secret||!identifier||!await verify(project.verification_secret,identifier,b.contact_hash))throw new HTTPException(403,{message:'Contact signature invalid'});verified=true}
 const signedEmail=verified&&typeof b.email==='string'&&b.email.trim().toLowerCase()===identifier!.trim().toLowerCase()
 // A signed identifier remains stable when email is omitted or edited. Only a
 // missing identifier may fall back to an independently proven mailbox.
 const lookup=async()=>await c.env.DB.prepare('SELECT id,metadata_json FROM contacts WHERE project_id=? AND external_id=? AND is_verified=1').bind(project.id,identifier).first<{id:string;metadata_json:string}>()||(signedEmail?await c.env.DB.prepare(`SELECT id,metadata_json FROM contacts ct WHERE project_id=? AND lower(trim(email))=lower(trim(?)) AND ${mailboxProofSql('ct')} ORDER BY is_verified DESC,created_at,id LIMIT 1`).bind(project.id,identifier).first<{id:string;metadata_json:string}>():null)
 const existing=verified?await lookup():null
 if(existing&&JSON.parse(existing.metadata_json||'{}').is_blocked)throw new HTTPException(403,{message:'Contact is blocked'})
 const contactId=existing?.id||id(),token=id()+id(),now=Date.now();const statements=[]
 // A typed email is where notifications may go; only a signature naming that very
 // address makes it the contact's for inbound mail (integrations/inbound-authority.ts).
 const email=typeof b.email==='string'?(signedEmail?b.email.trim().toLowerCase():b.email):null,typedEmail=email!==null&&!(verified&&email.trim().toLowerCase()===identifier!.trim().toLowerCase())
 if(existing&&signedEmail)statements.push(c.env.DB.prepare(`UPDATE contacts SET external_id=CASE WHEN (is_verified=1 AND external_id IS NOT NULL AND external_id NOT LIKE 'portal:%') OR EXISTS(SELECT 1 FROM contacts held WHERE held.project_id=contacts.project_id AND held.external_id=? AND held.id<>contacts.id) THEN external_id ELSE ? END,email=?,is_verified=1 WHERE id=? AND project_id=? AND ${contactWritable}`).bind(identifier,identifier,email,existing.id,project.id))
 if(!existing)statements.push(c.env.DB.prepare('INSERT INTO contacts(id,project_id,name,email,external_id,created_at,is_verified,metadata_json) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(project_id,external_id) DO NOTHING').bind(contactId,project.id,typeof b.name==='string'?b.name:null,email,verified?identifier:null,now,verified?1:0,typedEmail?'{"email_unproven":1}':'{}'))
 await c.env.DB.batch(statements.length?statements:[c.env.DB.prepare('SELECT 1')]);const actual=verified?await lookup():{id:contactId};if(!actual)throw new HTTPException(409,{message:'Verified contact identity conflict'})
 if(b.metadata&&typeof b.metadata==='object'&&!Array.isArray(b.metadata)&&b.metadata.hash){const {hash,...metadata}=b.metadata;const encoded=JSON.stringify(metadata).replaceAll('/','\\/').replace(/[\u007f-\uffff]/g,char=>'\\u'+char.charCodeAt(0).toString(16).padStart(4,'0'));if(!project.verification_secret||!await verify(project.verification_secret,encoded,hash))throw new HTTPException(403,{message:'Metadata signature invalid'});const updated=await updateSignedWidgetMetadata(c.env,project.id,actual.id,metadata);if(!updated.meta.changes)throw new HTTPException(403)}
 const observed=await c.env.DB.prepare(`UPDATE contacts SET metadata_json=json_patch(metadata_json,?) WHERE id=? AND project_id=? AND ${contactWritable} AND coalesce(json_extract(metadata_json,'$.is_blocked'),0)!=1 AND coalesce(json_extract(metadata_json,'$.is_deleted'),0)!=1`).bind(JSON.stringify(contactEnvironment(c.req.raw,b)),actual.id,project.id).run();if(!observed.meta.changes)throw new HTTPException(403)
 const admitted=await c.env.DB.prepare(`INSERT INTO sessions SELECT ?,?,?,'contact',?,?,NULL WHERE EXISTS(SELECT 1 FROM contacts WHERE id=? AND project_id=? AND ${contactWritable} AND coalesce(json_extract(metadata_json,'$.is_blocked'),0)!=1)`).bind(await hashToken(token),actual.id,project.id,actual.id,now+2592000000,actual.id,project.id).run();if(!admitted.meta.changes)throw new HTTPException(403);return c.json({token,contactId:actual.id,projectId:project.id,verified},201)
})
