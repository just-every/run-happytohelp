import type {Env} from '../../platform/env'
export const dimensions=['intent','sentiment','language'] as const
export type Dimension=typeof dimensions[number]
export type Prediction={value:string;confidence:number;quote:string}
export const defaults=[{id:'refund',name:'Refund'},{id:'shipping',name:'Shipping'},{id:'billing',name:'Billing'},{id:'bug',name:'Bug report'},{id:'how_to',name:'How-to'}].map(row=>({...row,active:true}))
export const defaultSettings={enabled:false,threshold:0.8,default_group_id:null as string|null,routing_enabled:false,version:0,taxonomy:defaults}
export async function settings(env:Env,projectId:string){
 const row=await env.DB.prepare('SELECT * FROM triage_settings WHERE project_id=?').bind(projectId).first<any>()
 return row?{...row,enabled:!!row.enabled,routing_enabled:!!row.routing_enabled,taxonomy:JSON.parse(row.taxonomy_json)}:{...defaultSettings,project_id:projectId}
}
export async function accuracy(env:Env,projectId:string,taxonomy:any[]){
 const rows=(await env.DB.prepare(`SELECT l.value intent_id,count(*) total,sum(CASE WHEN json_extract(l.prediction_json,'$.value')=l.value THEN 1 ELSE 0 END) correct FROM triage_labels l WHERE l.project_id=? AND l.field='intent' AND l.prediction_json IS NOT NULL AND NOT EXISTS(SELECT 1 FROM triage_labels newer WHERE newer.job_id=l.job_id AND newer.field=l.field AND (newer.at>l.at OR newer.at=l.at AND newer.rowid>l.rowid)) GROUP BY l.value`).bind(projectId).all<any>()).results
 return taxonomy.map(t=>{const row=rows.find(r=>r.intent_id===t.id);return {intent_id:t.id,name:t.name,total:row?.total??0,correct:row?.correct??0,accuracy:row?row.correct/row.total:null}})
}
export const liveJob=`SELECT j.*,m.content,c.contact_id FROM triage_jobs j JOIN conversations c ON c.id=j.conversation_id AND c.project_id=j.project_id JOIN messages m ON m.id=j.message_id AND m.project_id=j.project_id WHERE j.id=? AND m.erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM contact_erasures er WHERE er.project_id=c.project_id AND er.contact_id=c.contact_id) AND NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=c.project_id AND json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL)`
export const currentJob=`EXISTS(SELECT 1 FROM conversations c JOIN triage_settings s ON s.project_id=c.project_id WHERE c.id=triage_jobs.conversation_id AND s.enabled=1 AND s.version=triage_jobs.settings_version AND NOT EXISTS(SELECT 1 FROM messages newer WHERE newer.conversation_id=c.id AND newer.actor_role='contact' AND newer.revision>triage_jobs.source_revision) AND NOT EXISTS(SELECT 1 FROM contact_erasures er WHERE er.project_id=c.project_id AND er.contact_id=c.contact_id))`
export function fieldRows(){return dimensions.flatMap(field=>[{id:`triage_${field}`,name:field==='intent'?'Intent':`Triage ${field}`,type:'text'},{id:`triage_${field}_confidence`,name:`Triage ${field} confidence`,type:'decimal'},{id:`triage_${field}_quote`,name:`Triage ${field} quote`,type:'text'}])}
