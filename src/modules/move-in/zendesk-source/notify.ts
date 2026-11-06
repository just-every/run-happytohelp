import type {Env} from '../../../platform/env'
export const PULL_JOB='move-in.zendesk'
export async function enqueuePull(env:Env,pull:{id:string;project_id:string},delayMs=0){
 const message={type:PULL_JOB,id:pull.id,projectId:pull.project_id}
 if(delayMs>0)await env.JOBS.send(message,{delaySeconds:Math.min(43200,Math.ceil(delayMs/1000))});else await env.JOBS.send(message)
}
/** A pulled batch that becomes ready, completes or stops hands control back to its pull. */
export async function notifyPull(env:Env,run:{id:string;source?:string|null}){
 if(run.source!=='zendesk-pull')return
 const rows=(await env.DB.prepare("SELECT p.id,p.project_id FROM move_in_zendesk_pull_runs r JOIN move_in_zendesk_pulls p ON p.id=r.pull_id WHERE r.run_id=? AND p.state IN ('reviewing','applying')").bind(run.id).all<{id:string;project_id:string}>()).results
 for(const pull of rows)await enqueuePull(env,pull)
}
