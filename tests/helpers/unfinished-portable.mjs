import assert from 'node:assert/strict';
import {archiveStorage} from './rer-archive.mjs';

// An explicitly stopped writer boundary captures work whose executor vanished.
// The archive is then exercised through the ordinary export/import commands.
export async function interruptPortableWork(root,state,actorId){
 await archiveStorage(root,async({DB})=>{
  const now=new Date().toISOString();
  for(const status of ['queued','running']){
   const id='synthetic-happytohelp-'+status;
   await DB.prepare('INSERT INTO ai_generations(id,project_id,conversation_id,state,source_revision,actor_json,model,ai_id,ai_profile_json,created_at,updated_at) VALUES(?,?,?,?,0,?,?,?,?,?,?)').bind(id,state.projectId,state.conversationId,status,JSON.stringify({id:actorId,role:'owner'}),'synthetic-happytohelp-1','synthetic-happytohelp-2','{}',now,now).run();
   if(status==='running')await DB.prepare("INSERT INTO ai_attempts(id,generation_id,state,started_at) VALUES(?,?,'running',?)").bind(id,id,now).run();
   await DB.prepare('INSERT INTO context_jobs(id,project_id,subject_id,kind,state,source_revision,packet_json,model,created_at) VALUES(?,?,?,?,?,0,?,?,?)').bind(id,state.projectId,state.business.contactId,status==='queued'?'project':'agent',status,'{}','synthetic-happytohelp-1',Date.now()).run();
   await DB.prepare('INSERT INTO brand_generations(id,project_id,actor_id,request_id,prompt,model,size,quality,state,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(id,status==='queued'?state.projectId:state.workProjectId,actorId,id,'Retained interrupted illustration','synthetic-happytohelp-1','1024x1024','low',status,Date.now(),Date.now()+900000).run();
  }
  await DB.prepare("INSERT INTO knowledge_imports(id,project_id,platform,status,created_at,processing_started_at) VALUES('synthetic-happytohelp-1',?,'zendesk','processing',?,?)").bind(state.projectId,Date.now(),Date.now()).run();
  await DB.prepare("INSERT INTO ticket_batch_jobs(id,project_id,actor_json,authority_json,operation_json,selection_json,results_json,created_at,updated_at) VALUES('synthetic-happytohelp-1',?,?,?,?,?,?,?,?)").bind(state.projectId,JSON.stringify({id:actorId,role:'owner'}),JSON.stringify({actorId}),'{}',JSON.stringify([state.conversationId]),'[]',Date.now(),Date.now()).run();
  await DB.prepare("INSERT INTO billing_accounts(project_id,auto_top_up) VALUES(?,1) ON CONFLICT(project_id) DO UPDATE SET auto_top_up=1").bind(state.projectId).run();
  await DB.prepare("INSERT INTO billing_operations(id,project_id,kind,state,created_at) VALUES('synthetic-happytohelp-1',?,'top_up','pending',?)").bind(state.projectId,Date.now()).run();
 });
}

export async function verifyPortableWork(root,state){
 await archiveStorage(root,async({DB})=>{
  for(const [table,column,expected] of [
   ['ai_generations','state',['cancelled','uncertain']],['ai_attempts','state',['uncertain']],
   ['context_jobs','state',['superseded','uncertain']],['brand_generations','state',['failed','uncertain']],
   ['knowledge_imports','status',['failed']],['ticket_batch_jobs','state',['failed']],['billing_operations','state',['uncertain']],
  ]){
   const rows=(await DB.prepare(`SELECT ${column} value FROM ${table} WHERE id LIKE 'synthetic-happytohelp-%' ORDER BY id`).all()).results;
   assert.deepEqual(rows.map(row=>row.value),expected,table+' cannot replay archived work');
  }
  assert.equal((await DB.prepare('SELECT authority_json FROM ticket_batch_jobs WHERE project_id=?').bind(state.projectId).first()).authority_json,'{}');
  assert.equal((await DB.prepare('SELECT auto_top_up FROM billing_accounts WHERE project_id=?').bind(state.projectId).first()).auto_top_up,0);
  assert.equal((await DB.prepare('SELECT count(*) n FROM knowledge_versions WHERE dataset_id=?').bind(state.business.datasetId).first()).n,2,'both lexical knowledge versions survive');
 });
}
