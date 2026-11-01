import {knowledgeCatalog} from '../knowledge/public-sources'
import {anonymousReaders} from '../knowledge/door'
// @ts-ignore Broad public copy identity excludes private attribution/confidence changes.
import {personalizationFingerprint} from './profiles/personalization.js'
import type {Env} from '../../platform/env'
// @ts-ignore Original bounded evidence builders are retained CommonJS source.
import * as profileEvidence from './profiles/evidence.js'
// @ts-ignore Original monitoring packet builder.
import * as monitoring from './monitoring/context.js'
export async function readContextSource(env:Env,projectId:string,subjectId:string){
 const subject=await env.DB.prepare('SELECT * FROM context_subjects WHERE project_id=? AND subject_id=?').bind(projectId,subjectId).first<any>()
 if(!subject)throw new Error('Context subject missing')
 const [project,evidence,profiles,actions,summaries,insights,history,documents,summaryActions,summaryRows]=await Promise.all([
  env.DB.prepare('SELECT id,name FROM projects WHERE id=?').bind(projectId).first<any>(),
  env.DB.prepare('SELECT * FROM context_evidence WHERE project_id=? AND subject_id=? ORDER BY occurred_at DESC,id DESC LIMIT 96').bind(projectId,subjectId).all<any>(),
  env.DB.prepare('SELECT type,profile FROM context_profiles WHERE project_id=? AND subject_id=?').bind(projectId,subjectId).all<any>(),
  env.DB.prepare('SELECT id,action,occurred_at AS created_at FROM context_actions WHERE project_id=? AND subject_id=? ORDER BY occurred_at DESC,id DESC LIMIT 60').bind(projectId,subjectId).all<any>(),
  env.DB.prepare('SELECT id,summary,created_at FROM context_summaries WHERE project_id=? AND subject_id=? ORDER BY created_at DESC,id DESC LIMIT 12').bind(projectId,subjectId).all<any>(),
  env.DB.prepare('SELECT *,dismissed_at AS closed_at,help_type AS ai_type FROM context_insights WHERE project_id=? AND subject_id=? ORDER BY created_at DESC,id DESC LIMIT 20').bind(projectId,subjectId).all<any>(),
  env.DB.prepare(`SELECT m.id,m.content,m.created_at,CASE WHEN m.actor_role='contact' THEN c.contact_id ELSE NULL END contact_id FROM messages m JOIN conversations c ON c.id=m.conversation_id AND c.project_id=m.project_id WHERE m.project_id=? AND (c.contact_id=? OR m.actor_id=?) ORDER BY m.created_at DESC,m.id DESC LIMIT 40`).bind(projectId,subjectId,subjectId).all<any>(),
  knowledgeCatalog(env,projectId,anonymousReaders).then(results=>({results})),
  env.DB.prepare('SELECT id,action,occurred_at AS created_at FROM context_actions WHERE project_id=? AND subject_id=? ORDER BY occurred_at,id LIMIT 60').bind(projectId,subjectId).all<any>(),
  env.DB.prepare('SELECT id,summary,created_at FROM context_summaries WHERE project_id=? AND subject_id=? ORDER BY created_at,id LIMIT 12').bind(projectId,subjectId).all<any>(),
 ])
 const saved=Object.fromEntries(profiles.results.map(p=>[p.type,JSON.parse(p.profile)]))
 const extra=evidence.results.reverse()
 const actionRows=[...actions.results.reverse(),...extra.filter(e=>e.source==='customer_activity').map(e=>({id:e.id,action:e.content,created_at:e.occurred_at}))]
 const context:any={project:{...project,ai_profile:saved.project},contact:{ai_profile:saved.contact},agent:{ai_profile:saved.agent},projectOptimize:{ai_profile:saved.optimize},history:[...history.results.reverse(),...extra.filter(e=>['customer_message','agent_message'].includes(e.source)).map(e=>({id:e.id,content:e.content,contact_id:e.source==='customer_message'?subjectId:null,created_at:e.occurred_at}))],agent_messages:history.results.filter(m=>!m.contact_id),dataset_files:documents.results,actions:actionRows.map(a=>({...a,decrypted_action:()=>a.action})),summaries:[...summaries.results.reverse(),...extra.filter(e=>e.source==='customer_activity_summary').map(e=>({id:e.id,summary:e.content}))],last_insights:insights.results.map(i=>({...i,metadata:{evidence_ids:JSON.parse(i.evidence_ids)}})),available_ais:JSON.parse(subject.help_types).map((type:string)=>({type}))}
 const summaryPacket=monitoring.buildMonitoringPacket({...context,actions:summaryActions.results.map(a=>({...a,decrypted_action:()=>a.action})),summaries:summaryRows.results})
 return {subject,context,saved,insights:insights.results,summaryPacket}
}
export function profilePacket(kind:string,source:Awaited<ReturnType<typeof readContextSource>>){const packet=profileEvidence.buildProfileEvidencePacket(kind,source.context);if(kind==='optimizeContact')packet.evidence_fingerprint=personalizationFingerprint(packet);return packet}
export function monitoringPacket(source:Awaited<ReturnType<typeof readContextSource>>){return monitoring.buildMonitoringPacket(source.context)}
