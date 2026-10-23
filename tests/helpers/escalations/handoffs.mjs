import assert from 'node:assert/strict';

// Public handoff routes, with failures injected only at the Graph network edge.
export async function handoffBoundaries(h) {
 const {app,providers,records,root}=h,record=records.at(-1);
 const path=h.base+root(record)+'/teams';
 const selected={message_ids:[record.message.id],attachment_ids:[record.file.id]};
 const failures=[
  {status:401,body:{error:{code:'InvalidAuthenticationToken'}}},
  {status:403,body:{error:{code:'Forbidden'}}},
  {status:429,body:{error:{code:'TooManyRequests'}}},
  {status:503,body:{error:{code:'ServiceUnavailable'}}},
  {status:201,body:{}},
  {status:201,body:{id:'synthetic-happytohelp-303',webUrl:'https://outside.example/message'}},
 ];
 const before=(await h.snapshot(record)).handoffs.length;
 for(const response of failures){
  providers.teams.responses.push(response);
  const body={...selected,request_id:crypto.randomUUID()};
  assert.equal((await app.call(path,{token:h.token,body})).status,502);
  const count=providers.teams.received.length;
  assert.equal((await app.call(path,{token:h.token,body})).status,409);
  assert.equal(providers.teams.received.length,count,'a provider response without a confirmed handoff is not replayed');
  assert.equal((await h.snapshot(record)).handoffs.length,before);
  const operation=(await h.snapshot(record)).operations.find(op=>op.id===body.request_id);
  assert.equal(operation.state,'uncertain');
 }

 // Full selected content is validated before an operation or attachment grant
 // is stored. A user can narrow the selection and reuse the unsent request ID.
 const messageIds=[];
 for(let n=0;n<4;n++){
  const current=await app.ok(`/api/conversations/${record.ticket.id}`,{token:h.token});
  const message=await app.ok(`/api/conversations/${record.ticket.id}/messages`,{token:h.token,body:{localId:crypto.randomUUID(),content:'Export diagnostic & '.repeat(450),expectedRevision:current.revision,expectedLastMessageId:current.last_message_id}});
  messageIds.push(message.message.id);
 }
 for(const provider of ['teams','slack']){
  const body={message_ids:messageIds,attachment_ids:[record.file.id],request_id:crypto.randomUUID()};
  const route=h.base+root(record)+'/'+provider,count=providers[provider].received.length;
  const refused=await app.call(route,{token:h.token,body});assert.equal(refused.status,413);
  assert.equal(providers[provider].received.length,count,'oversized context sends nothing');
  assert.ok(!(await h.snapshot(record)).operations.some(op=>op.id===body.request_id));
  assert.equal(await app.first('SELECT 1 FROM escalation_attachment_grants WHERE operation_id=?',body.request_id),null);
  const accepted=await app.call(route,{token:h.token,body:{...body,message_ids:[record.message.id]}});
  assert.equal(accepted.status,201,'a corrected unsent request can be submitted');
  const handoff=accepted.data.data.handoffs.find(item=>item.id===body.request_id);assert.ok(handoff);
  const posted=providers[provider].received.findLast(request=>request.method==='POST');
  const grant=posted.json.body?.content??posted.json.text;
  const url=grant.match(/https?:\/\/[^\s]+\/api\/escalations\/attachments\/[^\s]+/)[0];
  const download=await app.request(new URL(url).pathname);assert.equal(download.status,200);assert.equal(await download.text(),'ABC');
 }
}
