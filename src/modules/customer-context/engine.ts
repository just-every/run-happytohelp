import {requireActiveProject,isProjectActive} from '../../platform/project-status'
import type {Env,Job} from '../../platform/env'
import {z} from '../validation/zod.js'
import {currentGuard,publishProfile,finishContextJob} from './outcomes'
// @ts-ignore Retained profile schemas.
import * as schemas from './profiles/schemas.js'
// @ts-ignore Retained prompts.
import * as profilePrompt from './profiles/prompt.js'
// @ts-ignore Retained monitoring prompts and packet evidence policy.
import * as monitorPrompt from './monitoring/prompt.js'
// @ts-ignore Retained monitoring provenance policy.
import * as monitoring from './monitoring/context.js'
// @ts-ignore Retained escalating dismissal cooldown.
import * as dismissal from './collector/insightCooldown.js'
export type ContextRequest=(env:Env,job:any,task:string,request:any)=>Promise<any>
export async function consumeContextJob(message:Job,env:Env,request:ContextRequest){
 if(message.type!=='context.run')return false
 if(typeof request!=='function')throw new TypeError('Customer context requires an explicit execution adapter')
 const job=await env.DB.prepare('SELECT * FROM context_jobs WHERE id=? AND project_id=?').bind(message.id,message.projectId).first<any>()
 if(!job||job.state!=='queued')return true
 if(!await isProjectActive(env,job.project_id)){await env.DB.prepare("UPDATE context_jobs SET state='failed',error='Project deleted before provider dispatch',finished_at=? WHERE id=? AND state='queued'").bind(Date.now(),job.id).run();return true}
 const requestProvider=request;request=async(env,current,task,input)=>{await requireActiveProject(env,current.project_id);const result=await requestProvider(env,current,task,input);await requireActiveProject(env,current.project_id);return result}
 const claim=await env.DB.prepare("UPDATE context_jobs SET state='running',started_at=? WHERE id=? AND state='queued' AND NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=context_jobs.project_id AND json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL)").bind(Date.now(),job.id).run()
 if(!claim.meta.changes)return true
 try{
  const current=await env.DB.prepare('SELECT revision,consent,bot_enabled FROM context_subjects WHERE project_id=? AND subject_id=?').bind(job.project_id,job.subject_id).first<any>()
  if(!current||current.revision!==job.source_revision){await finishContextJob(env,job,'superseded',{reason:'source_changed'});return true}
  if(['monitoring','contact','optimizeContact'].includes(job.kind)&&(!current.consent||!current.bot_enabled)){await finishContextJob(env,job,'no_op',{reason:'consent_or_bot_disabled'});return true}
  if(job.kind==='monitoring')await runMonitoring(env,job,request)
  else{
   const stored=JSON.parse(job.packet_json),context={...stored.context,profile_evidence_packet:stored.packet}
   const factories:any={project:schemas.projectSchema,agent:schemas.agentSchema,contact:schemas.contactSchema,optimize:schemas.projectContentOptimizeSchema,optimizeContact:schemas.optimizeContentSchema}
   const schema=factories[job.kind](context)
   const result=schema.parse(await request(env,job,'profile',{...profilePrompt.buildProfilePrompt(job.kind,context),schema}))
   await publishProfile(env,job,result)
  }
 }catch(error){
  const latest=await env.DB.prepare('SELECT provider_started FROM context_jobs WHERE id=?').bind(job.id).first<any>()
  const stale=String(error).includes('context_write_guards')||String(error).includes("result='ok'")
  await finishContextJob(env,job,stale?'superseded':latest?.provider_started?'uncertain':'failed',{},error)
 }
 return true
}
async function runMonitoring(env:Env,job:any,request:ContextRequest){
 const {packet,summaryPacket}=JSON.parse(job.packet_json)
 const dismissed=(await env.DB.prepare('SELECT help_type AS ai_type,dismissed_at AS closed_at FROM context_insights WHERE project_id=? AND subject_id=? AND dismissed_at IS NOT NULL').bind(job.project_id,job.subject_id).all()).results
 const recent=await env.DB.prepare('SELECT created_at FROM context_insights WHERE project_id=? AND subject_id=? ORDER BY created_at DESC LIMIT 1').bind(job.project_id,job.subject_id).first<any>()
 const reason=recent?.created_at>Date.now()-120000?'insight_cooldown':!packet.available_help_types.length?'no_enabled_ai':!packet.eligible_evidence_ids.length?'no_eligible_evidence':dismissal.getInsightDismissalCooldown(dismissed).active?'dismissal_cooldown':null
 if(reason){await finishContextJob(env,job,'no_op',{reason});return}
 const context={monitoring_packet:packet,available_ais:packet.available_help_types.map((type:string)=>({type}))}
 const analysisRequest=monitorPrompt.buildAnalysisRequest(context)
 const analysis=analysisRequest.schema.parse(await request(env,job,'analysis',analysisRequest))
 let insight:any=null
 if(analysis.decision==='insight'&&monitoring.evidenceIdsAreNew(analysis.evidence_ids,packet)){
  const insightRequest=monitorPrompt.buildInsightRequest({...context,analysis})
  const candidate=insightRequest.schema.parse(await request(env,job,'insight',insightRequest))
  insight={id:crypto.randomUUID(),...candidate,help_type:analysis.help_type}
 }
 // A summary compacts only the exact bounded evidence used by this run, after attributable analysis.
 const summaryRequest=monitorPrompt.buildSummaryRequest({...context,monitoring_packet:summaryPacket},z.object({summary:z.string().trim().min(1).max(2400)}).strict())
 const summary=summaryRequest.schema.parse(await request(env,job,'summary',summaryRequest))
 const statements=[currentGuard(env,job)]
 if(insight)statements.push(env.DB.prepare(`INSERT INTO context_insights(id,project_id,subject_id,help_type,content,buttons,evidence_ids,created_at) VALUES(?,?,?,?,?,?,?,?)`).bind(insight.id,job.project_id,job.subject_id,insight.help_type,insight.content,JSON.stringify(insight.buttons),JSON.stringify(insight.evidence_ids),Date.now()))
 statements.push(env.DB.prepare('INSERT INTO context_summaries(id,project_id,subject_id,summary,evidence_ids,created_at) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),job.project_id,job.subject_id,summary.summary,JSON.stringify(summaryPacket.eligible_evidence_ids),Date.now()))
 const actionIds=summaryPacket.direct_observations.map((e:any)=>e.evidence_id.replace(/^action:/,'')),summaryIds=summaryPacket.historical_summaries.map((e:any)=>e.evidence_id.replace(/^summary:/,''))
 statements.push(env.DB.prepare('DELETE FROM context_actions WHERE project_id=? AND subject_id=? AND id IN (SELECT value FROM json_each(?))').bind(job.project_id,job.subject_id,JSON.stringify(actionIds)),env.DB.prepare('DELETE FROM context_summaries WHERE project_id=? AND subject_id=? AND id IN (SELECT value FROM json_each(?))').bind(job.project_id,job.subject_id,JSON.stringify(summaryIds)),env.DB.prepare('DELETE FROM context_write_guards WHERE id=?').bind(job.id))
 await env.DB.batch(statements)
 await finishContextJob(env,job,insight?'completed':'no_op',{analysis,insight:insight?.id||null,reason:insight?'insight':analysis.decision==='no_insight'?'no_insight':'repeated_evidence'})
}
