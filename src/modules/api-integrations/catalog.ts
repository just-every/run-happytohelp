import type {Env} from '../../platform/env'
import {scoutPublic} from './helpscout'
import {eventScope} from './zapier'
/** Bounded metadata view. Provider errors, URLs, credentials and customer text are excluded. */
export async function connectorCatalog(env:Env,project:string){
 const credentials=await env.DB.prepare('SELECT id,scopes,revoked_at,expires_at FROM api_credentials WHERE namespace=? ORDER BY created_at DESC LIMIT 100').bind(project).all<any>()
 const live=credentials.results.filter(c=>c.revoked_at===null&&(c.expires_at===null||c.expires_at>Date.now())),scopes=[...new Set(live.flatMap(c=>JSON.parse(c.scopes)))].sort()
 const usage=(await env.DB.prepare('SELECT at,required_scopes,allowed FROM integration_token_usage WHERE namespace=? ORDER BY at DESC,id DESC LIMIT 200').bind(project).all<any>()).results
 const refused=usage.filter(row=>!row.allowed)
 const bearerActivity={health:refused.length?'degraded':'ok',failed:refused.length,shared_authority:true,attempts:usage.slice(0,3).map((row,index)=>({id:'usage-'+index,number:1,event:'bearer.request',state:row.allowed?'accepted':'refused',error_class:row.allowed?null:'authority_or_quota_refused',at:row.at,scopes:JSON.parse(row.required_scopes)}))}
 const deliveries=await env.DB.prepare(`SELECT i.id,d.kind,d.connector,i.error_code,v.state,v.attempts,e.event,a.number,a.started_at,a.finished_at,a.outcome,d.enabled FROM native_integration_intents i JOIN native_integration_destinations d ON d.id=i.destination_id AND d.project_id=i.project_id JOIN native_integration_events e ON e.id=i.event_id LEFT JOIN integration_deliveries v ON v.id=i.id AND v.namespace=i.project_id LEFT JOIN integration_attempts a ON a.delivery_id=v.id AND a.namespace=v.namespace AND a.number=v.attempts WHERE i.project_id=? ORDER BY e.created_at DESC,i.id LIMIT 200`).bind(project).all<any>()
 const destinations=await env.DB.prepare('SELECT kind,connector,events_json FROM native_integration_destinations WHERE project_id=? AND enabled=1 LIMIT 100').bind(project).all<any>()
 const base=(id:string,name:string)=>({id,name,scopes:[] as unknown[],health:'ok',queued:0,uncertain:0,failed:0,attempts:[] as any[],reconciliation:[] as any[],configured:false})
 const rows:any[]=[{...base('api','API tokens'),scopes,configured:live.length>0,...bearerActivity},{...base('mcp','MCP'),scopes,configured:live.length>0,...bearerActivity}]
 for(const [id,name] of [['webhooks','Webhooks'],['slack','Slack'],['zapier','Zapier hooks']]){
  const match=(r:any)=>id==='slack'?r.kind==='slack':r.kind==='webhook'&&(id==='zapier'?r.connector==='zapier':r.connector!=='zapier')
  const recent=deliveries.results.filter(match),configured=destinations.results.filter(match),row=base(id,name)
  row.configured=configured.length>0;row.scopes=[...new Set(configured.flatMap(d=>JSON.parse(d.events_json).map(eventScope)))].sort()
  for(const receipt of recent){const state=receipt.error_code?'rejected':receipt.state??'queued';if(state==='queued')row.queued++;if(state==='uncertain')row.uncertain++;if(state==='rejected')row.failed++
   const outcome=receipt.outcome?JSON.parse(receipt.outcome):null
   if(receipt.number)row.attempts.push({id:receipt.id,number:receipt.number,event:receipt.event,state,status:outcome?.status??null,error_class:outcome?.code??receipt.error_code??null,at:receipt.finished_at??receipt.started_at})
   if(state==='uncertain'&&receipt.kind==='webhook'&&receipt.enabled)row.reconciliation.push({label:'Resend uncertain webhook',path:'/deliveries/'+receipt.id+'/resend',body:{attempt:receipt.attempts}})
  }
  row.health=row.failed?'failing':row.uncertain?'degraded':'ok';rows.push(row)
 }
 const scout=await env.DB.prepare('SELECT * FROM helpscout_connections WHERE project_id=?').bind(project).first<any>()
 rows.push({...base('helpscout','Help Scout'),configured:!!scout?.secret_ciphertext,health:scout?.error_class?'failing':'ok',scopes:['Inbox read','Changes waiting only'],...scoutPublic(scout),...(scout?.secret_ciphertext?{reconciliation:[{label:'Pull Help Scout now',path:'/helpscout/pull',body:{}}]}:{})} as any)
 return rows
}
