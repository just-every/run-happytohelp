import {preparedSql} from './prepared-sql'
import {authority} from '../context'
import {redactionStatements} from '@runeditrun/rer/modules/portability/journal'
import type {Env} from '../../../platform/env'
import type {D1Sql,D1ImportPerson} from '../../import-kit/src/d1/types'
import {retireD1ImportCustody} from '../../import-kit/src/d1/index'
import {nativeTargets} from '../targets'
import {writeImportDoorSettings} from '../../import-kit/src/door/index'

/** Keep portability's real restore checkpoint in the same kit retirement batch.
 * Capture SQL from its public statement builder; all reads still use real D1. */
async function checkpoint(db:D1Database):Promise<D1Sql[]>{
 const queries=new WeakMap<object,D1Sql>()
 const track=(statement:D1PreparedStatement,query:D1Sql):D1PreparedStatement=>{
  const proxy=new Proxy(statement,{get(target,key){if(key==='bind')return (...params:any[])=>track(target.bind(...params),{sql:query.sql,params});const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value}})
  queries.set(proxy,query);return proxy
 }
 const recording=new Proxy(db,{get(target,key){if(key==='prepare')return (sql:string)=>track(target.prepare(sql),{sql,params:[]});const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value}})
 return (await redactionStatements(recording)).map((statement:D1PreparedStatement)=>{const query=queries.get(statement);if(!query)throw new Error('import_checkpoint_untracked');return query})
}
export async function withdrawDoorCustody(env:Env,projectId:string,principalId:string,person:D1ImportPerson,sessionHash?:string){
 // Close admission before taking the custody snapshot. An upload already in
 // flight then fails Base's in-batch settings guard; a new one cannot race the
 // following native workspace deletion and leave private bytes behind.
 const bindings=(await env.DB.prepare('SELECT installation_id FROM h2h_import_door_claim WHERE project_id=? AND owner_id=?').bind(projectId,principalId).all<{installation_id:string}>()).results
 if(bindings.length&&!sessionHash)throw new Error('IMPORT_ERASURE_AUTHORITY_REQUIRED')
 const current=authority({project_id:projectId,actor_id:principalId,session_hash:sessionHash??''})
 for(const binding of bindings)await writeImportDoorSettings(env.DB,binding.installation_id,{enabled:false},{sql:`(${current.sql}) AND EXISTS(SELECT 1 FROM memberships WHERE project_id=? AND user_id=? AND role='owner')`,params:[...current.params!,projectId,principalId]})
 const held=await env.DB.prepare('SELECT 1 FROM ik_door_scopes WHERE destination=? LIMIT 1').bind(projectId).first()
 if(!held)return
 if(!sessionHash)throw new Error('IMPORT_ERASURE_AUTHORITY_REQUIRED')
 const jobs=(await env.DB.prepare(`SELECT j.operation_key FROM ik_door_plans p JOIN ik_jobs j ON j.id=p.job_id OR (p.job_id IS NULL AND j.operation_key='door:'||p.id) WHERE j.destination=?`).bind(projectId).all<{operation_key:string}>()).results.map(row=>row.operation_key)
 await retireD1ImportCustody({...person,values:[...person.values??[],...jobs]},[],{destination:projectId,namespace:'zendesk',mappingVersion:'happytohelp-move-in-1',storage:{database:env.DB,targets:nativeTargets},authorization:{principalId,predicate:(_action,destination)=>destination===projectId?current:{sql:'0'}}},await checkpoint(env.DB))
}
export async function eraseDoorContact(env:Env,projectId:string,contactId:string,principalId:string,emails:string[],sessionHash:string|undefined,build:(env:Env)=>Promise<{native:D1PreparedStatement[];checkpoint:D1PreparedStatement[]}>){
 const capture=preparedSql(env),statements=await build(capture.env)
 if(!await env.DB.prepare('SELECT 1 FROM ik_door_scopes WHERE destination=? LIMIT 1').bind(projectId).first()){await env.DB.batch(capture.raw([...statements.checkpoint,...statements.native]));return}
 if(!sessionHash)throw new Error('IMPORT_ERASURE_AUTHORITY_REQUIRED')
 const origin=await env.DB.prepare("SELECT vendor,source_id FROM move_in_origins WHERE project_id=? AND target_kind='contact' AND target_id=?").bind(projectId,contactId).first<{vendor:string;source_id:string}>()
 // HH's older Move in custody is indivisible and its native builder retires it
 // whole. Tell Base those exact operations are retiring, rather than rewriting
 // a journal the same transaction deliberately removes.
 const retiring=(await env.DB.prepare(`SELECT j.operation_key FROM ik_jobs j JOIN move_in_erasure_runs e ON j.id=e.job_id OR (j.destination=e.project_id AND (j.operation_key=e.run_id OR substr(j.operation_key,1,length(e.run_id)+1)=e.run_id||'/')) WHERE e.project_id=? AND e.contact_id=?`).bind(projectId,contactId).all<{operation_key:string}>()).results.map(row=>row.operation_key)
 const doorJobs=(await env.DB.prepare(`SELECT DISTINCT j.operation_key FROM ik_door_plans p JOIN ik_jobs j ON j.id=p.job_id OR (p.job_id IS NULL AND j.operation_key='door:'||p.id) WHERE j.destination=?1 AND p.bundle_sha256 IN (SELECT l.bundle_sha256 FROM h2h_import_door_identities l JOIN move_in_erased_identities e ON e.project_id=l.project_id AND e.digest=l.digest WHERE l.project_id=?1)`).bind(projectId).all<{operation_key:string}>()).results.map(row=>row.operation_key)
 const current=authority({project_id:projectId,actor_id:principalId,session_hash:sessionHash})
 await retireD1ImportCustody({target:{kind:'contact',id:contactId},values:[...emails,...retiring,...doorJobs],related:origin?.vendor==='zendesk'?{source(record){const payload=record.payload as any;return record.kind==='user'&&record.sourceId===origin.source_id||record.kind==='ticket'&&(String(payload.requester_id)===origin.source_id||Array.isArray(payload.comments)&&payload.comments.some((comment:any)=>String(comment.author_id)===origin.source_id))}}:undefined},capture.queries(statements.native),{destination:projectId,namespace:'zendesk',mappingVersion:'happytohelp-move-in-1',storage:{database:env.DB,targets:nativeTargets},authorization:{principalId,predicate:(_action,destination)=>destination===projectId?current:{sql:'0'}}},capture.queries(statements.checkpoint))
}
