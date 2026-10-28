import assert from 'node:assert/strict'
import {pbkdf2Sync,randomBytes} from 'node:crypto'
import {mkdtemp,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {readArtifact} from '../helpers/artifact-payloads.mjs'
import {recoveryRuntime} from '../helpers/recovery/runtime.mjs'
import {snapshot} from '../helpers/recovery/snapshot.mjs'

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
  for(const migration of migrations)await writeFile(join(runtime.directory,'migrations',migration.name),migration.sql)
  await runtime.run(['d1','migrations','apply','DB','--local','--persist-to','.wrangler/state'])
  await runtime.withStorage(async storage=>{
   const after=await snapshot(storage)
   assert.deepEqual(after.objects,before.objects,'all prior attachment bytes and metadata survive')
   for(const [table,rows] of Object.entries(before.rows)){
    if(['sqlite_sequence','d1_migrations','owner_setup'].includes(table))continue
    const current=(after.rows[table]||[]).map(JSON.parse)
    for(const encoded of rows){const row=JSON.parse(encoded);assert.ok(current.some(candidate=>Object.entries(row).every(([key,value])=>candidate[key]===value)),table+' retains its prior business row')}
   }
  })
  await runtime.start()
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
