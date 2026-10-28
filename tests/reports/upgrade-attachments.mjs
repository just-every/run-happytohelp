import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'

// Exercise the emitted Worker against the prior attachment schema, then apply
// the real additive migration without replacing any native media or note rows.
export async function attachmentSchemaUpgrade(runtime,migration,verifyUpgraded){
 const token='synthetic-hh-upgrade-owner',visitor='synthetic-hh-upgrade-visitor'
 const digest=value=>createHash('sha256').update(value).digest('hex')
 await runtime.withStorage(async({inspect})=>{
  const sql=(sql,values=[])=>inspect({sql,values})
  await sql("INSERT OR IGNORE INTO users(id,email,name,created_at) VALUES('upgrade-agent','upgrade-agent@example.test','Upgrade agent',1)")
  await sql("INSERT OR IGNORE INTO memberships VALUES('upgrade-project','upgrade-agent','owner')")
  await sql("INSERT INTO sessions(token_hash,actor_id,project_id,role,contact_id,expires_at) VALUES(?,'upgrade-agent','upgrade-project','owner',NULL,?),(?,'upgrade-contact','upgrade-project','contact','upgrade-contact',?)",[digest(token),Date.now()+3600000,digest(visitor),Date.now()+3600000])
  await sql("INSERT OR IGNORE INTO conversation_notes(id,conversation_id,user_id,content,created_at) VALUES('upgrade-note','upgrade-open','upgrade-agent','Retained private note',21)")
  for(const [id,message] of [['upgrade-public','upgrade-question'],['upgrade-private',null]]){
   await sql('INSERT OR IGNORE INTO media(id,project_id,conversation_id,uploaded_by,object_key,filename,content_type,size,message_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',[id,'upgrade-project','upgrade-open','upgrade-agent',id,id+'.txt','text/plain',id.length,message,22])
   await inspect({key:id,bytes:[...Buffer.from(id)]})
  }
  await sql("INSERT INTO conversation_note_media VALUES('upgrade-note','upgrade-private')")
  await sql('DROP TABLE move_in_attachment_bytes')
  await sql('DELETE FROM d1_migrations WHERE name=?',[migration.name])
 })
 const results=[]
 async function observe(stage){
  await runtime.start()
  try{
   const request=(path,auth=token)=>fetch(runtime.origin+path,{headers:{Authorization:`Bearer ${auth}`}})
   for(const id of ['upgrade-public','upgrade-private']){
    const response=await request('/api/conversations/upgrade-open/media/'+id)
    results.push({stage,door:id,status:response.status})
    if(response.status===200)assert.equal(await response.text(),id,'retained native bytes')
   }
   const denied=await request('/api/conversations/upgrade-open/media/upgrade-private',visitor)
   results.push({stage,door:'private visitor denial',status:denied.status})
   const publicRead=await request('/api/conversations/upgrade-open/media/upgrade-public',visitor)
   results.push({stage,door:'public visitor read',status:publicRead.status})
   const transcript=await request('/api/conversations/upgrade-open/messages')
   results.push({stage,door:'public transcript',status:transcript.status})
   const privateTranscript=await request('/api/dashboard/conversations/upgrade-open/buckets')
   results.push({stage,door:'private transcript',status:privateTranscript.status})
   if(stage==='migrated'&&verifyUpgraded)await verifyUpgraded();
   if(privateTranscript.status===200){
    const body=await privateTranscript.json(),note=body.data.flatMap(bucket=>bucket.events).find(event=>event.id==='upgrade-note')
    assert.deepEqual(note.media.map(media=>media.id),['upgrade-private'],'native note attachments survive the missing import schema')
   }
  }finally{await runtime.close()}
 }
 await observe('absent table')
 await runtime.withStorage(async({inspect})=>{await inspect({sql:'CREATE TABLE move_in_attachment_bytes(media_id TEXT,project_id TEXT,conversation_id TEXT,base64 TEXT)'})})
 await observe('absent note_id column')
 await runtime.withStorage(async({inspect})=>{await inspect({sql:'DROP TABLE move_in_attachment_bytes'})})
 await runtime.run(['d1','migrations','apply','DB','--local','--persist-to','.wrangler/state'])
 await observe('migrated')
 console.log('Attachment upgrade door results '+JSON.stringify(results))
 assert.deepEqual(results.filter(row=>row.status!==(row.door==='private visitor denial'?404:200)),[],'every prior-schema and upgraded media and transcript door remains available with private denial')
}
