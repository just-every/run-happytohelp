import assert from 'node:assert/strict'
import {join} from 'node:path'
import {writeLegacyPackage} from '../legacy-package.mjs'
import {putPackage} from './journey.mjs'
/** Same matched workspace, via the real HTTP start/result and consumeQueue. */
export async function deltaJourney(runtime,scratch,bundle,token){
 const project=bundle.source.projectId,first=bundle.tables.messages[0],conversation=bundle.tables.conversations.find(row=>row.id===first.conversation_id),edited={...first,content:first.content+' Legacy added a later sentence.'},fresh={...first,id:'synthetic-delta-message',local_id:first.local_id,content:'Synthetic delta addition',created_at:100000}
 const start=async(name,messages,whole)=>{
  const root=join(scratch,name),exported=await writeLegacyPackage(root,whole,{rowsPerChunk:2,delta:{since:'2026-01-02T00:00:00Z',tables:{conversations:[conversation],messages}}}),sha=exported.manifestSha256,base=`/api/move-in/projects/${project}/legacy-import/${sha}`
  await putPackage(runtime,root,exported.manifest,sha,project);await runtime.call(base+'/start',{token,body:{approvedManifestSha256:sha},status:202});let queue=await runtime.take()
  for(let n=0;n<2000;n++){
   const run=await runtime.db.prepare('SELECT state,error_code,phase FROM legacy_import_worker_runs WHERE id=?').bind(`legacy-package:${sha}`).first()
   assert.notEqual(run.state,'paused',JSON.stringify(run));if(run.state==='complete'){const result=(await runtime.call(base+'/result',{token,status:200})).data.data;assert.equal(result.journalEqualsPackage,true);assert.equal(result.work.unchanged,true);return {result,id:`legacy-package:${sha}`}}
   const jobs=queue.splice(0,1);assert.equal(jobs.length,1);const step=await runtime.step(jobs);queue.push(...step.queue)
  }
  throw new Error('Delta did not settle')
 }
 const context={...bundle,tables:{...bundle.tables,messages:[edited,...bundle.tables.messages.slice(1),fresh]}}
 const delta=await start('delta-one',[edited,fresh],context)
 const conflictCount=await runtime.db.prepare('SELECT count(*) n FROM legacy_import_conflicts WHERE run_id IN (SELECT journal_run_id FROM legacy_import_worker_parts WHERE run_id=?)').bind(delta.id).first()
 assert.equal(conflictCount.n,0,'the changed delta has no spurious hash conflict')
 const read=(await runtime.call(`/api/conversations/${conversation.id}/messages`,{token,status:200})).data.messages
 assert.ok(read.find(row=>row.id===edited.id).content===edited.content,'the owner reads the complete changed delta literal');assert.ok(read.some(row=>row.id===fresh.id));assert.notEqual(read.find(row=>row.id===fresh.id).local_id,first.local_id,'native delivery IDs stay unique')
 const state=(await runtime.call('/_test/legacy/state-match',{body:{messageId:edited.id},status:200})).data
 assert.equal(state.matches,true)
 const frontier=(await runtime.call(`/api/conversations/${conversation.id}`,{token,status:200})).data
 const native=await runtime.call(`/api/conversations/${conversation.id}/messages`,{token,body:{localId:'synthetic-native-after-import',content:'A native conversation change',expectedRevision:frontier.revision,expectedLastMessageId:frontier.last_message_id},status:200});assert.equal(native.data.accepted,true)
 await runtime.take()
 const later={...fresh,id:'synthetic-held-message',local_id:'synthetic-held-local',content:'A later legacy addition',created_at:200000}
 const held=await start('delta-two',[later],{...context,tables:{...context.tables,messages:[...context.tables.messages,later]}})
 const conflicts=await runtime.db.prepare('SELECT count(*) n FROM legacy_import_conflicts WHERE run_id IN (SELECT journal_run_id FROM legacy_import_worker_parts WHERE run_id=?)').bind(held.id).first()
 assert.ok(conflicts.n>0);assert.equal(await runtime.db.prepare('SELECT 1 FROM messages WHERE id=?').bind(later.id).first(),null,'a native-edited conversation withholds new legacy messages')
 return {stateMatches:state.matches,deltaConflicts:conflictCount.n,nativeChangeConflicts:conflicts.n,deltaApplied:delta.result.attempt.appliedRows}
}
