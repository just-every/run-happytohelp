import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv,Actor} from '../../platform/env'
import {scope} from '../management/common'
import {memberAccess} from '../access/gate'
import {requireStepUp} from '../identity/two-factor/step-up'
import {auditStatement,requestSource} from '../audit/record'
import {text,link} from '../feedback/access'
import {kinds,agreements,qualification,type EvidenceKind} from './model'
const root='/projects/:projectId'
async function administrator(c:any){const actor=await scope(c,true) as Actor,access=await memberAccess(c.env.DB,actor.projectId,actor.id);if(!access?.permissions.has('settings.manage'))throw new HTTPException(403);return actor}
const stamp=(value:unknown)=>{const n=typeof value==='string'?Date.parse(value):NaN;if(!Number.isSafeInteger(n))throw new HTTPException(400,{message:'Use a valid ISO date and time'});return n}
function timezone(value:unknown){const zone=text(value,'IANA timezone',100);try{if(zone!=='UTC'&&!zone.includes('/'))throw Error();new Intl.DateTimeFormat('en-US',{timeZone:zone}).format()}catch{throw new HTTPException(400,{message:'Use an IANA timezone such as America/New_York'})}return zone}
export const assuranceRoutes=new Hono<AppEnv>()
assuranceRoutes.use('*',async(c,next)=>{c.header('Cache-Control','no-store');await next()})
assuranceRoutes.get(root,async c=>{const actor=await administrator(c);return c.json({data:await qualification(c.env,actor.projectId)})})
assuranceRoutes.put(root,async c=>{
 const actor=await administrator(c);await requireStepUp(c,actor,'assurance.configure');const body=await c.req.json()
 if(body.country!=='US'||body.currency!=='USD'||body.recording_enabled!==false)throw new HTTPException(400,{message:'Qualification currently requires US contracts, USD and recording disabled. Recording requires separate channel-specific qualification.'})
 const partner=text(body.partner,'qualification partner',200),deployment=text(body.deployment_ref,'isolated deployment reference',500),zone=timezone(body.timezone),now=Date.now()
 await c.env.DB.batch([c.env.DB.prepare('INSERT INTO assurance_profiles(project_id,requested_at,partner,deployment_ref,timezone,updated_by,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET partner=excluded.partner,deployment_ref=excluded.deployment_ref,timezone=excluded.timezone,revision=assurance_profiles.revision+1,updated_by=excluded.updated_by,updated_at=excluded.updated_at').bind(actor.projectId,now,partner,deployment,zone,actor.id,now),auditStatement(c.env.DB,{projectId:actor.projectId,category:'approval',action:'assurance.qualification_requested',actor:{type:'user',id:actor.id},source:requestSource(c),detail:{country:'US',currency:'USD',recording:false}})])
 return c.json({data:await qualification(c.env,actor.projectId)})
})
assuranceRoutes.post(root+'/evidence',async c=>{
 const actor=await administrator(c);await requireStepUp(c,actor,'assurance.evidence');const body=await c.req.json(),kind=text(body.kind,'evidence kind') as EvidenceKind
 if(!(kinds as readonly string[]).includes(kind))throw new HTTPException(400,{message:'Choose a supported agreement or control'})
 const required=(agreements as readonly string[]).includes(kind)?'executed':kind==='subprocessor'?'approved':'passed'
 if(body.status!==required)throw new HTTPException(400,{message:`This record requires status ${required}`})
 const from=stamp(body.valid_from),expires=stamp(body.expires_at),now=Date.now()
 if(from>now||expires<=now||expires<=from)throw new HTTPException(400,{message:'Evidence must be effective now with a future expiry'})
 const provider=text(body.provider,'provider or verifier',200),reference=link(body.reference),id=crypto.randomUUID(),settings=body.settings??{}
 if(kind==='subprocessor'&&(settings.region!=='US'||settings.model_training!==false||settings.baa_covered!==true||!Number.isInteger(settings.retention_days)||settings.retention_days<0||settings.retention_days>3650))throw new HTTPException(400,{message:'Record US region, no model training, BAA coverage and explicit retention days'})
 // Only allow defined, non-secret provider settings into the evidence store.
 const details=kind==='subprocessor'?{region:'US',model_training:false,baa_covered:true,retention_days:settings.retention_days}:{}
 await c.env.DB.batch([c.env.DB.prepare('INSERT INTO assurance_evidence VALUES(?,?,?,?,?,?,?,?,?,?,?,NULL)').bind(id,actor.projectId,kind,provider,reference,actor.id,now,from,expires,required,JSON.stringify(details)),auditStatement(c.env.DB,{projectId:actor.projectId,category:'approval',action:'assurance.evidence_recorded',actor:{type:'user',id:actor.id},source:requestSource(c),target:{type:'assurance_evidence',id},detail:{kind}})])
 return c.json({id,data:await qualification(c.env,actor.projectId)},201)
})
assuranceRoutes.post(root+'/evidence/:id/revoke',async c=>{
 const actor=await administrator(c);await requireStepUp(c,actor,'assurance.revoke');const id=c.req.param('id')!,now=Date.now()
 const result=await c.env.DB.batch([c.env.DB.prepare("UPDATE assurance_evidence SET status='revoked',revoked_at=? WHERE project_id=? AND id=? AND revoked_at IS NULL").bind(now,actor.projectId,id),auditStatement(c.env.DB,{projectId:actor.projectId,category:'approval',action:'assurance.evidence_revoked',actor:{type:'user',id:actor.id},source:requestSource(c),target:{type:'assurance_evidence',id}},now,{sql:'EXISTS(SELECT 1 FROM assurance_evidence WHERE id=? AND project_id=? AND revoked_at=?)',params:[id,actor.projectId,now]})])
 if(!result[0].meta.changes)throw new HTTPException(404)
 return c.json({data:await qualification(c.env,actor.projectId)})
})
assuranceRoutes.post(root+'/activate',async c=>{const actor=await administrator(c);await requireStepUp(c,actor,'assurance.activate');const data=await qualification(c.env,actor.projectId);await auditStatement(c.env.DB,{projectId:actor.projectId,category:'approval',action:'assurance.activation_refused',outcome:'refused',actor:{type:'user',id:actor.id},source:requestSource(c),detail:{blockers:data.blockers.length,independentReviewPending:true}}).run();return c.json({error:data.activation_blocker,data},409)})
assuranceRoutes.get(root+'/report',async c=>{const actor=await administrator(c),data=await qualification(c.env,actor.projectId);await auditStatement(c.env.DB,{projectId:actor.projectId,category:'data',action:'assurance.report_exported',actor:{type:'user',id:actor.id},source:requestSource(c)}).run();c.header('Content-Disposition','attachment; filename="regulated-deployment-qualification.json"');c.header('Cache-Control','no-store');return c.json({data})})
