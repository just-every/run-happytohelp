import assert from 'node:assert/strict'
import {assertReferenceUpgrade} from '../helpers/knowledge/reference-upgrade.mjs'
import {pbkdf2Sync,randomBytes} from 'node:crypto'
import {mkdtemp,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {readArtifact} from '../helpers/artifact-payloads.mjs'
import {recoveryRuntime} from '../helpers/recovery/runtime.mjs'
import {snapshot} from '../helpers/recovery/snapshot.mjs'
import {restoredKnowledgeReady} from '../helpers/recovery/knowledge-ready.mjs'

// An older populated installation is upgraded in place. Its data and password
// are read through the current application, rather than pinning migration names.
export async function priorSchemaUpgrade(){
 const artifact=await readArtifact('delivery-artifact/happytohelp-worker-artifact.json')
 const migrations=artifact.deploymentSpec.migrations,prior=migrations.filter(m=>parseInt(m.name,10)<=111)
 const directory=await mkdtemp(join(tmpdir(),'h2h-upgrade-')),password='synthetic-retained-owner-password',salt=randomBytes(16).toString('hex')
 const hash=salt+':'+pbkdf2Sync(password,salt,100000,32,'sha256').toString('hex')
 const bytes=[0,3,255,128,42],project='synthetic-upgrade',user='synthetic-owner',contact='synthetic-customer',thread='synthetic-request'
 let runtime
 try{
  artifact.deploymentSpec.migrations=prior
  runtime=await recoveryRuntime(artifact,{directory:join(directory,'runtime'),port:18370,inspectorPort:18371,variables:{}})
  let before
  await runtime.withStorage(async storage=>{
   const write=(sql,values=[])=>storage.inspect({sql,values})
   await write('INSERT INTO projects(id,name,widget_key,allowed_origin,created_at,verification_secret) VALUES(?,?,?,?,?,?)',[project,'Retained support','synthetic-widget','https://customer.example',1,'synthetic-signed-identity-secret'])
   await write('INSERT INTO users VALUES(?,?,?,?)',[user,'owner@upgrade.example','Retained owner',1])
   await write('INSERT INTO memberships VALUES(?,?,?)',[project,user,'owner'])
   await write('INSERT INTO credentials VALUES(?,?,?)',[user,hash,1])
   await write('INSERT INTO contacts(id,project_id,name,email,created_at) VALUES(?,?,?,?,?)',[contact,project,'Retained customer','customer@upgrade.example',2])
   await write('INSERT INTO conversations(id,project_id,contact_id,revision,last_message_id,created_at,updated_at,resolved_at) VALUES(?,?,?,?,?,?,?,?)',[thread,project,contact,2,'synthetic-answer',3,6,6])
   for(const [id,actor,role,text,revision,at] of [['synthetic-question',contact,'contact','Where is my receipt?',1,4],['synthetic-answer',user,'owner','Here is the retained receipt.',2,5]]){
    await write('INSERT INTO messages(id,project_id,conversation_id,local_id,actor_id,actor_role,content,revision,created_at) VALUES(?,?,?,?,?,?,?,?,?)',[id,project,thread,id,actor,role,text,revision,at])
   }
   await write('INSERT INTO media(id,project_id,conversation_id,uploaded_by,object_key,filename,content_type,size,message_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',['synthetic-file',project,thread,user,'synthetic/receipt','receipt.bin','application/octet-stream',bytes.length,'synthetic-answer',5])
   await storage.inspect({key:'synthetic/receipt',bytes,options:{httpMetadata:{contentType:'application/octet-stream'},customMetadata:{purpose:'retained-receipt'}}})
   await write('INSERT INTO knowledge_articles(id,project_id,slug,title,content,summary,status,updated_at) VALUES(?,?,?,?,?,?,?,?)',['synthetic-article',project,'receipts','Receipt guide','Your receipt remains available.','', 'published',5])
   before=await snapshot(storage)
  })
  for(const migration of migrations.filter(m=>parseInt(m.name,10)<291))await writeFile(join(runtime.directory,'migrations',migration.name),migration.sql)
  await runtime.run(['d1','migrations','apply','DB','--local','--persist-to','.wrangler/state'])
  let beforeKnowledge
  await runtime.withStorage(async storage=>{
   await storage.inspect({sql:'INSERT INTO operator_ticket_commands(project_id,actor_id,local_id,conversation_id,intent_hash,kind,created_at) VALUES(?,?,?,?,?,?,?)',values:[project,user,'retained-call-command',thread,'retained-intent','call',7]})
   for(const [id,kind] of [['synthetic-retained-email','email'],['synthetic-retained-call','call']]){
    await storage.inspect({sql:'INSERT INTO conversations(id,project_id,contact_id,channel,created_at,updated_at) VALUES(?,?,?,?,?,?)',values:[id,project,contact,kind==='email'?'email':'phone',7,7]})
    await storage.inspect({sql:'INSERT INTO operator_ticket_commands(project_id,actor_id,local_id,conversation_id,intent_hash,kind,created_at) VALUES(?,?,?,?,?,?,?)',values:[project,user,'command-'+id,id,'intent-'+id,kind,8]})
   }
   beforeKnowledge=await snapshot(storage)
  })
  const knowledgeStarted=Date.now()
  for(const migration of migrations.filter(m=>parseInt(m.name,10)>=291))await writeFile(join(runtime.directory,'migrations',migration.name),migration.sql)
  await runtime.run(['d1','migrations','apply','DB','--local','--persist-to','.wrangler/state'])
  const knowledgeFinished=Date.now()
  await runtime.withStorage(async storage=>{
   const after=await snapshot(storage)
   const command=after.rows.operator_ticket_commands.map(JSON.parse).find(row=>row.local_id==='retained-call-command')
   assert.deepEqual(command,{project_id:project,actor_id:user,local_id:'retained-call-command',conversation_id:thread,intent_hash:'retained-intent',kind:'call',created_at:7,support_thread_id:null},'299 preserves populated command identities and defaults')
   const commands=after.rows.operator_ticket_commands.map(JSON.parse),priorCommands=beforeKnowledge.rows.operator_ticket_commands.map(JSON.parse)
   assert.equal(priorCommands.length,3);assert.equal(commands.length,priorCommands.length)
   for(const retained of priorCommands)assert.deepEqual(commands.find(row=>row.conversation_id===retained.conversation_id),{...retained,support_thread_id:null},'299 preserves every populated email/call command byte and defaults its new link')
   console.log('PROBE OUTBOUND-001 B1 upgrade: populated pre-299 installation -> native D1 migration apply -> all 3/3 existing operator commands preserved, including email/call identities, intent hashes and default NULL links')
   for(const table of ['knowledge_article_publications','knowledge_generation_sources','knowledge_index_dirty','knowledge_upgrade_reports','knowledge_upgrade_progress'])assert.equal(assertReferenceUpgrade(table,after.rows[table],beforeKnowledge.rows,after.rows,knowledgeStarted,knowledgeFinished),true)
   assert.deepEqual(after.objects,before.objects,'all prior attachment bytes and metadata survive')
   for(const [table,rows] of Object.entries(before.rows)){
    if(['sqlite_sequence','d1_migrations','owner_setup'].includes(table))continue
    const current=(after.rows[table]||[]).map(JSON.parse)
    for(const encoded of rows){const row=JSON.parse(encoded);assert.ok(current.some(candidate=>Object.entries(row).every(([key,value])=>candidate[key]===value)),table+' retains its prior business row')}
   }
   await assertUpgradedCommands(storage,{project,user,thread})
  })
  await runtime.start()
  await restoredKnowledgeReady(runtime,project,'receipts')
  const call=async(path,body,token)=>{
   const response=await fetch(runtime.origin+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)})
   assert.equal(response.ok,true,`${path}: ${response.status}`);return response.json()
  }
  const owner=await call('/api/identity/login',{email:'owner@upgrade.example',password})
  assert.equal(owner.actor.id,user);assert.equal(owner.actor.projectId,project)
  assert.equal((await call('/api/identity/setup')).available,false)
  const messages=await call(`/api/conversations/${thread}/messages`,undefined,owner.token)
  assert.deepEqual(messages.messages.map(m=>[m.id,m.content]),[['synthetic-question','Where is my receipt?'],['synthetic-answer','Here is the retained receipt.']])
  assert.equal(messages.revision,2);assert.equal(messages.lastMessageId,'synthetic-answer')
  const media=await fetch(runtime.origin+`/api/conversations/${thread}/media/synthetic-file`,{headers:{Authorization:'Bearer '+owner.token}})
  assert.equal(media.status,200);assert.deepEqual([...new Uint8Array(await media.arrayBuffer())],bytes)
  assert.equal((await call(`/api/knowledge/public/${project}/articles/receipts`)).content,'Your receipt remains available.')
  const reports=await call(`/api/dashboard/projects/${project}/reports?period=custom&start=1970-01-01&end=1970-01-02`,undefined,owner.token)
  assert.equal(reports.aiResolution.total,1);assert.equal(reports.aiResolution.count,0,'incomplete historical provenance never becomes a claimed AI resolution')
  const sent=await call(`/api/conversations/${thread}/messages`,{localId:'synthetic-after-upgrade',content:'Your account is still supported.',expectedRevision:2,expectedLastMessageId:'synthetic-answer',authoring:{kind:'human'}},owner.token)
  assert.equal(sent.accepted,true)
  assert.equal((await call(`/api/conversations/${thread}/messages`,undefined,owner.token)).messages.at(-1).content,'Your account is still supported.')
 }finally{if(runtime)await runtime.close();await rm(directory,{recursive:true,force:true})}
}

async function assertUpgradedCommands(storage,{project,user,thread}){
 const write=(sql,values=[])=>storage.inspect({sql,values})
 const contact='synthetic-command-erasure',ticket='synthetic-command-erasure-ticket',earlier='synthetic-command-earlier-intake',connection='synthetic-upgrade-channel',link='synthetic-upgrade-thread'
 await write('INSERT INTO contacts(id,project_id,name,email,created_at) VALUES(?,?,?,?,?)',[contact,project,'Command erasure customer','erasure@upgrade.example',9])
 for(const id of [ticket,earlier])await write('INSERT INTO conversations(id,project_id,contact_id,channel,created_at,updated_at) VALUES(?,?,?,?,?,?)',[id,project,contact,'sms',9,9])
 const insert='INSERT INTO operator_ticket_commands(project_id,actor_id,local_id,conversation_id,intent_hash,kind,created_at,support_thread_id) VALUES(?,?,?,?,?,?,?,?)'
 await assert.rejects(()=>write(insert,[project,user,'retained-call-command',ticket,'changed-intent','call',9,null]),/UNIQUE constraint failed/,'the original command key still refuses a different ticket')
 await assert.rejects(()=>write(insert,[project,user,'duplicate-ticket-command',thread,'changed-intent','call',9,null]),/UNIQUE constraint failed/,'one conversation still belongs to only one creation command')
 await assert.rejects(()=>write(insert,[project,user,'invalid-thread-command',ticket,'invalid-thread-intent','sms',9,'missing-upgrade-thread']),/FOREIGN KEY constraint failed/,'a command cannot link an absent channel thread')
 await write('INSERT INTO support_channel_connections(id,project_id,provider,account,sender,channels_json,verify_hash,created_at) VALUES(?,?,?,?,?,?,?,?)',[connection,project,'sms','synthetic-upgrade-account','+12025550124','["sms"]','synthetic-upgrade-verifier',9])
 const insertThread=()=>write('INSERT INTO support_channel_threads(id,project_id,connection_id,contact_id,conversation_id,identity_hash,recipient,channel_id,thread_key,last_inbound_at) VALUES(?,?,?,?,?,?,?,?,?,?)',[link,project,connection,contact,ticket,'synthetic-upgrade-identity','+12025550123','sms','synthetic-upgrade-thread-key',9])
 await insertThread()
 await write(insert,[project,user,'linked-upgrade-command',ticket,'linked-upgrade-intent','sms',9,link])
 const command=async()=>(await write('SELECT * FROM operator_ticket_commands WHERE conversation_id=?',[ticket])).results[0]
 const linked=await command()
 assert.equal(linked.support_thread_id,link,'an upgraded command retains its valid channel thread')
 await write('DELETE FROM support_channel_threads WHERE id=?',[link])
 assert.deepEqual(await command(),{...linked,support_thread_id:null},'thread deletion clears only the link and retains command identity')
 await insertThread()
 await write('UPDATE operator_ticket_commands SET support_thread_id=? WHERE conversation_id=?',[link,ticket])
 for(const [id,conversation,state] of [['synthetic-upgrade-earlier-send',earlier,'sending'],['synthetic-upgrade-current-send',ticket,'accepted']])await write('INSERT INTO support_channel_sends(message_id,project_id,conversation_id,connection_id,state,provider_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',[id,project,conversation,connection,state,'synthetic-provider-'+id,9,9])
 await write("UPDATE contacts SET metadata_json=json_set(metadata_json,'$.is_erased',1) WHERE id=? AND project_id=?",[contact,project])
 assert.deepEqual(await command(),{...linked,local_id:'erased:'+ticket,intent_hash:null,support_thread_id:null},'rebuilt commands retain their keys and kind while erasure scrubs intent and detaches the deleted thread')
 assert.equal((await write('SELECT id FROM support_channel_threads WHERE id=?',[link])).results.length,0)
 const sends=(await write('SELECT conversation_id,state,provider_id,error_code FROM support_channel_sends WHERE connection_id=? ORDER BY conversation_id',[connection])).results
 assert.deepEqual(sends,[{conversation_id:earlier,state:'uncertain',provider_id:null,error_code:'contact_erased'},{conversation_id:ticket,state:'accepted',provider_id:null,error_code:'contact_erased'}],'erasure scrubs both the current ticket and earlier intake sends after the thread pointer moved')
 console.log('PROBE OUTBOUND-001-PERF P5: populated migration preserves command rows; duplicate keys/conversations and missing thread links refuse; valid links survive, thread deletion nulls only the link, and contact erasure redacts commands plus current/earlier send receipts')
}
