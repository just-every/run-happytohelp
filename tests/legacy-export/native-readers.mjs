import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {readFile,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {createRuntime} from '../helpers/emitted-runtime.mjs'
import {client} from '../journeys/kit/http.mjs'
const sha=bytes=>createHash('sha256').update(bytes).digest('hex')
const quote=value=>"'"+String(value).replaceAll("'","''")+"'"
const data=result=>result.data.data??result.data
/** Expected source normalization is written here independently of mapLegacy. */
export async function nativeReaders({persist,sources,files,output,ownerId}){
 const config=JSON.parse(await readFile('wrangler.jsonc','utf8'))
 const runtime=await createRuntime({persist,databaseId:config.d1_databases[0].database_id,bucketName:config.r2_buckets[0].bucket_name,outboundFixture:new URL('./no-outbound.mjs',import.meta.url).href})
 const facts=[]
 try{
  const {call,request}=client(runtime.origin)
  const tokens=sources.map((_,i)=>'synthetic-export-reader-'+i)
  await runtime.execute(sources.map((source,i)=>`INSERT OR REPLACE INTO sessions(token_hash,actor_id,project_id,role,expires_at) VALUES(${quote(sha(tokens[i]))},${quote(ownerId)},${quote(source.source.projectId)},'owner',${Date.now()+3600000})`).join(';')+';')
  for(const [i,source] of sources.entries()){
   const projectId=source.source.projectId,token=tokens[i],conversations=source.tables.conversations
   const inbox=data(await call(`/api/dashboard/projects/${projectId}/conversations?view=all`,{token,status:200}))
   assert.ok(inbox.some(c=>c.id===conversations[0].id))
   for(const original of conversations){
    const ticket=data(await call(`/api/dashboard/projects/${projectId}/conversations/${original.id}`,{token,status:200}))
    assert.equal(ticket.subject,original.metadata.subject)
    const transcript=(await call(`/api/conversations/${original.id}/messages`,{token,status:200})).data.messages
    const expected=source.tables.messages.filter(m=>m.conversation_id===original.id&&!m.deleted_at).sort((a,b)=>Date.parse(a.created_at)-Date.parse(b.created_at)||a.id.localeCompare(b.id))
    assert.deepEqual(transcript.map(m=>m.id),expected.map(m=>m.id))
    for(const msg of transcript){
     const original=expected.find(m=>m.id===msg.id)
     assert.equal(msg.created_at,Date.parse(original.created_at))
     assert.equal(msg.actor_role,original.contact_id?'contact':original.agent_id===source.tables.ais[0]?.id?'ai':original.agent_id?'operator':'system')
     for(const media of msg.media??[]){
      const file=await request(`/api/conversations/${msg.conversation_id}/media/${media.id}`,{token})
      assert.equal(file.status,200)
      const bundle=JSON.parse(await readFile(files[i],'utf8')),object=bundle.objects.find(o=>o.key===source.tables.media.find(m=>m.id===media.id)?.object_key)
      assert.ok(object);assert.equal(sha(Buffer.from(await file.arrayBuffer())),object.sha256)
     }
    }
   }
   const contact=source.tables.contacts[0],customer=data(await call(`/api/management/projects/${projectId}/contacts/${contact.id}`,{token,status:200}))
   assert.equal(customer.name,contact.provided_name||contact.name||contact.nickname||null)
   assert.equal(customer.email,contact.provided_email||contact.email||null)
   assert.equal(customer.is_verified,1,'administrative CLI verification policy is intentionally separate')
   const settings=data(await call(`/api/management/projects/${projectId}/settings`,{token,status:200}))
   assert.equal(settings.timezone,source.tables.projects[0].timezone)
   const categories=(await call(`/api/knowledge/${projectId}/categories`,{token,status:200})).data
   assert.equal(categories.length,source.tables.categories.length)
   const articles=(await call(`/api/knowledge/${projectId}/articles`,{token,status:200})).data
   assert.deepEqual(new Set(articles.map(a=>a.id)),new Set(source.tables.articles.map(a=>a.id)))
   const known=source.tables.macros.find(m=>m.created_by_id),unknown=source.tables.macros.find(m=>m.created_by_id===null)
   const macro=data(await call(`/api/management/projects/${projectId}/macros/${known.id}`,{token,status:200}))
   assert.equal(macro.title,known.title)
   await call(`/api/management/projects/${projectId}/macros/${unknown.id}`,{token,status:404})
   const note=source.tables.events.find(e=>e.type==='INTERNAL_NOTE'),conversation=conversations.find(c=>c.id===note.conversation_id)
   const buckets=data(await call(`/api/dashboard/conversations/${conversation.id}/buckets`,{token,status:200}))
   const strings=value=>typeof value==='string'?[value]:Array.isArray(value)?value.flatMap(strings):value&&typeof value==='object'?Object.values(value).flatMap(strings):[]
   assert.ok(strings(buckets).includes(note.payload),'private note JSON string is rendered once, without double encoding')
   const path=`/api/conversations/${conversation.id}/messages`
   await call(path,{status:401})
   // Foreign contact authority, not another legitimate source owner who belongs
   // to both projects, must be refused.
   const foreignContact=sources[1-i].tables.contacts[0],foreign='synthetic-foreign-contact-'+i
   await runtime.execute(`INSERT OR REPLACE INTO sessions(token_hash,actor_id,project_id,role,contact_id,expires_at) VALUES(${quote(sha(foreign))},${quote(foreignContact.id)},${quote(sources[1-i].source.projectId)},'contact',${quote(foreignContact.id)},${Date.now()+3600000});`)
   await call(path,{token:foreign,status:404})
   for(const row of source.tables.media.filter(m=>m.directory.includes('synthetic-notes'))){
    const path=`/api/conversations/${conversation.id}/media/${row.id}`
    assert.ok([401,404].includes((await request(path)).status))
    assert.equal((await request(path,{token:foreign})).status,404)
    assert.equal((await request(`/api/imported-files/${projectId}/${row.id}`)).status,404)
   }
   facts.push({projectId,inbox:true,subjects:conversations.length,transcriptOrder:true,authorship:true,utcMilliseconds:true,privateNote:true,contact:true,cliVerificationRetained:true,articlesAndDrafts:true,categories:true,savedReply:true,unknownCliReply:'held',settings:true,attachments:'SHA-256 exact',signedOutDenied:true,foreignContactDenied:true,privateSharedFilesDenied:true})
  }
  await writeFile(join(output,'native-readers.json'),JSON.stringify({runtime:'emitted real Worker / local D1 / local R2',facts},null,2))
  return facts
 }finally{await runtime.close(true)}
}
