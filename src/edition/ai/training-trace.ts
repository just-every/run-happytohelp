import type {Env} from '../../platform/env'
import {canonicaliseFields} from '../../modules/knowledge/canonicaliser'
import {referenceResult} from '../../modules/knowledge/result-fields'
/** Persist each paid round before execution can advance to another stage. */
export async function recordTrainingEvent(env:Env,projectId:string,attemptId:string,event:any){
 if(['agent_start','cost_update','agent_done','error','stream_end'].includes(event.type))await env.DB.prepare('INSERT INTO training_model_events(attempt_id,project_id,type,event_json,created_at) VALUES(?,?,?,?,?)').bind(attemptId,projectId,event.type,JSON.stringify(await referenceResult(env,projectId,'training:'+attemptId,await canonicaliseFields(env,projectId,event),'trace')),Date.now()).run()
 if(event.type==='agent_start'&&event.request_id)await env.DB.prepare('INSERT OR IGNORE INTO training_model_rounds(attempt_id,request_id,project_id,model) VALUES(?,?,?,?)').bind(attemptId,event.request_id,projectId,event.agent?.model||null).run()
 if(event.type==='cost_update'&&event.request_id)await env.DB.prepare('INSERT INTO training_model_rounds(attempt_id,request_id,project_id,model,usage_json,observed) VALUES(?,?,?,?,?,1) ON CONFLICT(attempt_id,request_id) DO UPDATE SET model=excluded.model,usage_json=excluded.usage_json,observed=1').bind(attemptId,event.request_id,projectId,event.usage?.model||null,JSON.stringify(event.usage)).run()
}
