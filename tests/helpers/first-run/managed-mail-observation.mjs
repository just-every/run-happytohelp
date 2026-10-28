import assert from 'node:assert/strict'
import {managedInstallation} from '../email/rer-mail.mjs'

// The existing Setup observation journey also runs on Managed mail, including
// adoption and a due bind retry. Every D1 table stays byte-for-byte unchanged.
export async function managedReadOnlyJourney(){
 for(const phase of ['adoption','retry']){
  const i=await managedInstallation('read-'+phase,{bindings:{MAIL_PROVIDER:''}}),{app,owner,edge}=i
  try{
   await app.configure({MAIL_PROVIDER:'rer'})
   if(phase==='retry'){
    edge.conflict=true
    await app.ok(`/api/management/projects/${owner.projectId}/email-settings/managed/retry`,{token:owner.token,method:'POST'})
    edge.conflict=false
    await app.db.prepare("UPDATE rer_mailbox_outbox SET state='pending',next_at=0 WHERE project_id=?").bind(owner.projectId).run()
   }
   const tables=(await app.sql("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")).map(row=>row.name).filter(name=>!name.startsWith('_cf_')&&!name.startsWith('sqlite_'))
   const snapshot=async()=>Promise.all(tables.map(name=>app.sql('SELECT * FROM "'+name.replaceAll('"','""')+'"')))
   const before=await snapshot(),calls=edge.controls.length
   for(const path of ['activation','email-settings','github']){
    const read=await app.call(`/api/management/projects/${owner.projectId}/${path}`,{token:owner.token})
    assert.equal(read.status,200,phase+' '+path)
   }
   assert.equal(edge.controls.length,calls,phase+' reads do no control-service work')
   assert.deepEqual(await snapshot(),before,phase+' reads write no rows')
   await app.scheduled();await app.drainJobs()
   assert.equal((await i.settings()).managed.state,'active','cron still adopts or retries')
  }finally{await i.close()}
 }
}
