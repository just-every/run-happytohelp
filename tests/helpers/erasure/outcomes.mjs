import assert from 'node:assert/strict'
import {cp,mkdir,mkdtemp,readFile,rm,stat,symlink} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {tmpdir} from 'node:os'
import {randomBytes,createHash} from 'node:crypto'
import {parseJsonc} from '@runeditrun/rer/jsonc'
import {fileRecords} from '@runeditrun/rer/modules/portability/files'
import {createRuntime} from '../emitted-runtime.mjs'
import {archiveSnapshot} from '../rer-archive.mjs'
import {run} from '../rer-command.mjs'
import {suppliedFreshdesk,publicBytes,privateBytes} from '../../move-in/supplied-attachments.mjs'

const digest=bytes=>createHash('sha256').update(bytes).digest('hex')
async function archive(path){
 let manifest
 const rows={},objects=[]
 // Validate the actual command's complete archive, including decoded R2 bytes.
 for await(const record of fileRecords(path)){
  if(record.kind==='manifest')manifest=record
  if(record.kind==='part')for(const item of record.items){
   if(item.kind==='row')(rows[item.table]??=[]).push(item.row)
   if(item.kind==='object')objects.push({...item,bytes:Buffer.from(item.data,'base64').toString()})
  }
 }
 assert.ok(manifest)
 return {manifest,rows,objects}
}

// Called by the existing erasure journey, without another test registration.
// All mutations enter the emitted application or the public rer command. D1/R2
// are inspected only after stopping the application that owns those stores.
export async function erasureOutcomes(){
 const source=resolve('.'),scratch=await mkdtemp(join(tmpdir(),'h2h-erasure-outcomes-'))
 let runtime,success=false
 async function fixture(name){
  const root=join(scratch,name);await mkdir(root)
  for(const entry of ['scripts','src','migrations','docs','management','package.json','seed.json','OPERATIONS.json','OPERATIONS.md','ACCEPTANCE.md','rer-setup.json','wrangler.jsonc','deploy.json'])await cp(join(source,entry),join(root,entry),{recursive:true})
  await symlink(join(source,'node_modules'),join(root,'node_modules'),'dir')
  return root
 }
 try{
  const root=await fixture('source'),config=parseJsonc(await readFile(join(root,'wrangler.jsonc'),'utf8'))
  const start=async()=>{runtime=await createRuntime({persist:join(root,'.wrangler/state'),databaseId:config.d1_databases[0].database_id,bucketName:config.r2_buckets[0].bucket_name,queueConsumers:true})}
  const stop=async()=>{await runtime.close(true);runtime=undefined}
  const request=async(path,{token,body,method=body===undefined?'GET':'POST',headers={},status=200,raw=false}={})=>{
   const response=await fetch(runtime.origin+path,{method,headers:{...(token?{Authorization:`Bearer ${token}`} :{}),...(body===undefined||raw?{}:{'Content-Type':'application/json'}),...headers},body:body===undefined?undefined:raw?body:JSON.stringify(body)})
   const text=await response.text()
   assert.equal(response.status,status,`${method} ${path}: unexpected HTTP status`)
   return text?JSON.parse(text):null
  }
  await start()
  const owner={email:'erasure-outcomes-owner@example.test',password:randomBytes(24).toString('base64url')}
  const {projectId}=await request('/api/identity/bootstrap',{body:{...owner,name:'Erasure outcomes',allowedOrigin:runtime.origin},status:201})
  const {token}=await request('/api/identity/login',{body:owner})
  const base=`/api/management/projects/${projectId}`,imports=`/api/move-in/projects/${projectId}/imports`
  const original=suppliedFreshdesk().map(JSON.stringify).join('\n')
  const upload=(body,status=201)=>request(imports+'?vendor=freshdesk',{token,status,raw:true,body,headers:{'Content-Type':'application/octet-stream','X-Import-Filename':'customer-history.jsonl'}})
  const wait=async(id,state)=>{
   for(let attempt=0;attempt<240;attempt++){
    const {data}=await request(`${imports}/${id}`,{token})
    if(data.state===state)return data
    assert.equal(data.error,null,JSON.stringify(data.error))
    await new Promise(done=>setTimeout(done,250))
   }
   assert.fail(`Import did not reach ${state}`)
  }
  const uploaded=(await upload(original)).data,ready=await wait(uploaded.id,'ready')
  assert.equal(ready.plan.counts.rejected,0)
  await request(`${imports}/${ready.id}/apply`,{token,body:{fingerprint:ready.plan.fingerprint},status:202})
  await wait(ready.id,'completed')
  const customer=(await request(base+'/contacts',{token})).data.find(row=>row.email==='ada@example.test')
  assert.ok(customer,'the public import populated a real customer')
  // A disjoint native visitor provides positive controls in the same export.
  const project=await request(`/api/identity/projects/${projectId}`,{token})
  const kept=await request('/api/identity/widget/session',{body:{widgetKey:project.widget_key,email:'kept-erasure@example.test',name:'Kept erasure peer'},headers:{Origin:runtime.origin},status:201})
  const keptConversation=await request('/api/conversations',{token:kept.token,body:{projectId},status:201})
  const keptMedia=await request(`/api/conversations/${keptConversation.id}/media`,{token:kept.token,raw:true,body:'kept attachment bytes',headers:{'Content-Type':'text/plain','X-Filename':'kept.txt'},status:201})
  assert.equal((await request(`/api/conversations/${keptConversation.id}/messages`,{token:kept.token,body:{localId:'kept-command',content:'Retained peer transcript',expectedRevision:0,mediaIds:[keptMedia.id]}})).accepted,true)
  await stop()
  const before=await archiveSnapshot(root)
  const conversation=before.rows.conversations.map(JSON.parse).find(row=>row.contact_id===customer.id)
  const messages=before.rows.messages.map(JSON.parse).filter(row=>row.conversation_id===conversation.id)
  const media=before.rows.media.map(JSON.parse).filter(row=>row.conversation_id===conversation.id)
  assert.ok(messages.length>=3);assert.equal(media.length,2)
  assert.ok(before.rows.move_in_notes.map(JSON.parse).some(row=>row.conversation_id===conversation.id))
  assert.ok(before.rows.move_in_records.length>0)
  await run(root,['export','--output','exports/before.rer'])
  const oldPath=join(root,'exports/before.rer'),oldBytes=await readFile(oldPath),oldHash=digest(oldBytes),old=await archive(oldPath)
  assert.ok(JSON.stringify(old.rows).includes('ada@example.test'))
  for(const file of media){
   const bytes=old.rows.move_in_attachment_bytes.find(row=>row.media_id===file.id)
   assert.ok(bytes,'supplied imported bytes are retained in D1, not a fabricated R2 object')
   assert.deepEqual(Buffer.from(bytes.base64,'base64'),file.filename==='public-receipt.txt'?publicBytes:privateBytes)
  }
  assert.ok(old.objects.some(object=>object.key.startsWith('move-in/')),'the old archive also holds the R2 source originals')

  await start()
  const erased=(await request(`${base}/contacts/${customer.id}/erase`,{token,body:{}})).data
  assert.equal(erased.conversations,1);assert.equal(erased.messages,messages.length);assert.ok(erased.attachments>=media.length)
  assert.deepEqual(erased.providers.counts,{completed:0,pending:0,failed:0,unsupported:0})
  const record=(await request(`${base}/contacts/${customer.id}/erasure`,{token})).data
  assert.equal(record.runs,1);assert.equal(record.erased_at,erased.erased_at)
  const transcript=await request(`/api/conversations/${conversation.id}/messages`,{token})
  assert.equal(transcript.revision,conversation.revision)
  assert.equal(transcript.lastMessageId,conversation.last_message_id)
  assert.ok(transcript.messages.length>0)
  assert.ok(transcript.messages.every(message=>message.content===''&&message.erased_at&&message.media.length===0))
  // Non-machine stale API and dashboard commands cannot revive old identity/text.
  await request(`${base}/contacts/${customer.id}`,{token,method:'PUT',body:{name:'Ada Customer',email:'ada@example.test'},status:409})
  assert.equal((await request(`/api/conversations/${conversation.id}/messages`,{token,body:{localId:messages[0].local_id,content:messages[0].content,expectedRevision:0},status:409})).accepted,false)
  for(const body of [original,'\n'+original,original.replaceAll('ada@example.test','changed-erasure@example.test')])await upload(body,410)
  await request(`${imports}/${ready.id}/resume`,{token,body:{},status:409})
  await stop()

  const after=await archiveSnapshot(root),contact=after.rows.contacts.map(JSON.parse).find(row=>row.id===customer.id)
  assert.deepEqual([contact.name,contact.email,contact.external_id],[null,null,null])
  assert.equal(JSON.parse(contact.metadata_json).is_erased,1)
  assert.equal(after.rows.move_in_runs.map(JSON.parse).find(row=>row.id===ready.id).state,'erased')
  assert.deepEqual(after.rows.move_in_records,[])
  assert.ok(after.rows.move_in_erased_identities.length>0,'hash-only import tombstones remain')
  assert.ok(!JSON.stringify(after.rows.move_in_erased_identities).includes('ada@'))
  assert.ok(!after.rows.move_in_notes.map(JSON.parse).some(row=>row.conversation_id===conversation.id))
  assert.deepEqual(after.rows.move_in_attachment_bytes,[],'supplied imported attachment bytes are deleted from D1')
  assert.ok(!after.rows.media.map(JSON.parse).some(row=>row.conversation_id===conversation.id))
  assert.ok(!after.objects.some(object=>object.key.startsWith('move-in/')),'the retained source archive is deleted')
  const peer=row=>JSON.parse(row).conversation_id===keptConversation.id
  assert.deepEqual(after.rows.messages.filter(peer),before.rows.messages.filter(peer))
  assert.deepEqual(after.objects.filter(object=>object.key.includes(keptMedia.id)),before.objects.filter(object=>object.key.includes(keptMedia.id)))
  await run(root,['export','--output','exports/after.rer'])
  const current=await archive(join(root,'exports/after.rer'))
  for(const marker of ['Ada Customer','ada@example.test','ada.alt@example.test','Where is my refund?','Private triage','Refund sent.','Thanks!'])assert.ok(!JSON.stringify(current).includes(marker),`erased imported content remains in export: ${marker}`)
  assert.ok(current.rows.contacts.some(row=>row.id===customer.id&&row.email===null))
  assert.deepEqual(current.rows.move_in_attachment_bytes??[],[],'erased imported file bytes do not enter the new export')
  assert.ok(current.rows.contact_erasures.some(row=>row.contact_id===customer.id))
  assert.ok(current.rows.messages.some(row=>row.conversation_id===conversation.id&&row.content===''&&row.erased_at))
  assert.ok(current.rows.messages.some(row=>row.content==='Retained peer transcript'))
  assert.ok(current.objects.some(object=>object.bytes==='kept attachment bytes'))
  assert.equal((await stat(join(root,'exports/after.rer'))).mode&0o777,0o600)
  // Erasure cannot recall an offline copy: its unchanged private bytes still need
  // deletion by its custodian. A later erasure journal must fence stale restore.
  assert.equal(digest(await readFile(oldPath)),oldHash,'old offline archive deletion remains unresolved; no recall claimed')
  assert.ok(current.manifest.epoch>old.manifest.epoch,'contact erasure advances the portable redaction checkpoint')
  const destination=await fixture('destination');await mkdir(join(destination,'exports'))
  for(const name of ['before','after'])await cp(join(root,`exports/${name}.rer`),join(destination,`exports/${name}.rer`))
  const refusal=await run(destination,['import','--input','exports/before.rer','--journal','exports/after.rer','--yes'],4)
  assert.ok(refusal.events.some(event=>event.event==='error'&&event.code==='restore_refused'&&/erasure_epoch/.test(event.message)),'stale restore reports a public refusal')
  const empty=await archiveSnapshot(destination)
  assert.deepEqual(empty.rows.contacts,[]);assert.deepEqual(empty.objects,[],'refused restore writes no private files')
  await run(destination,['import','--input','exports/after.rer','--yes'])
  const restored=await archiveSnapshot(destination)
  assert.deepEqual(restored.rows.contact_erasures,after.rows.contact_erasures)
  assert.deepEqual(restored.rows.move_in_erased_identities,after.rows.move_in_erased_identities)
  assert.equal(restored.rows.contacts.map(JSON.parse).find(row=>row.id===customer.id).email,null)
  console.log('ERASURE-001 outcomes: populated import D1/R2/export redaction; non-machine stale API/import refusal; offline archive remains unresolved; stale restore fenced by later journal; tombstones survive restore.')
  success=true
 }finally{
  await runtime?.close(false)
  if(success)await rm(scratch,{recursive:true,force:true})
  else console.error('Erasure outcome failure artifacts retained:',scratch)
 }
}
