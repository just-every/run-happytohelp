import assert from 'node:assert/strict';

export async function privateContext(h,record){
 const {app,token}=h,path=`/api/conversations/${record.ticket.id}`;
 const upload=async(name,content)=>app.ok(path+'/media',{token,body:Buffer.from(content),raw:true,headers:{'Content-Type':'text/plain','X-Filename':name}});
 const privateFile=await upload('private-engineering.txt','Private engineering attachment');
 await app.ok(`/api/dashboard/projects/${h.ws.projectId}/conversations/${record.ticket.id}/notes`,{token,body:{content:'Private engineering attachment note',media_ids:[privateFile.id]}});
 const uncheckedFile=await upload('unchecked-customer.txt','Unchosen customer attachment');
 const current=await app.ok(path,{token});
 await app.ok(path+'/messages',{token,body:{localId:crypto.randomUUID(),content:'Another public diagnostic, not selected for engineering.',mediaIds:[uncheckedFile.id],expectedRevision:current.revision,expectedLastMessageId:current.last_message_id}});
 const state=await h.snapshot(record);
 assert.ok(!state.messages.flatMap(message=>message.attachments).some(file=>file.id===privateFile.id));
 for(const provider of ['github','linear','jira','slack','teams']){
  const endpoint=h.base+h.root(record)+(provider==='slack'||provider==='teams'?'/'+provider:'/links');
  const before=h.providers[provider].received.length;
  const denied=await app.call(endpoint,{token,body:{provider,mode:'create',title:'Private context refused',message_ids:[record.message.id],attachment_ids:[privateFile.id],request_id:crypto.randomUUID()}});
  assert.equal(denied.status,400);assert.equal(h.providers[provider].received.length,before);
 }
 return async()=>{
  for(const file of [privateFile,uncheckedFile]){
   assert.equal(await app.first('SELECT 1 FROM escalation_attachment_grants WHERE media_id=?',file.id),null);
   for(const provider of Object.values(h.providers))if(provider.received){
    const sent=JSON.stringify(provider.received.map(request=>request.json));
    assert.ok(!sent.includes(file.filename));
   }
  }
 };
}
