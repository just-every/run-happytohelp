import assert from 'node:assert/strict'

// The reply is saved through the normal composer door, while the network edge
// refuses or loses its delivery. Diagnostics must preserve that distinction.
export async function deliveryCategories(app,state){
 const {token,b,p,preexisting,door,counts}=state,before=await counts()
 const outcomes=[]
 for(const [marker,expectedState,expectedCategory] of [['synthetic-c2-refusal','failed','provider_refusal'],['synthetic-c2-uncertain','uncertain','provider_uncertain']]){
  const started=Date.now(),localId=`c2scratch4-harm-${started}`
  const thread=(await app.call(`/api/conversations/${b}/messages`,{token,status:200})).data
  const reply=await app.call(`/api/conversations/${b}/messages`,{token,body:{localId,content:`A synthetic delivery observation: ${marker}.`,expectedRevision:thread.revision,expectedLastMessageId:thread.lastMessageId},status:200})
  assert.equal(reply.data.accepted,true)
  const query=new URLSearchParams({scenario:'harmless-reply',messageId:preexisting.id,conversationId:b,localId,from:String(started),to:String(started+60000)})
  let receipt;const until=Date.now()+10000
  do{receipt=(await app.call(door+'/receipts?'+query,{token,status:200})).data.data;if(receipt.deliveries.length&&!receipt.deliveries.some(row=>row.state==='sending'))break;await new Promise(resolve=>setTimeout(resolve,50))}while(Date.now()<until)
  assert.equal(receipt.savedReplies,1)
  assert.deepEqual(receipt.deliveries,[{state:expectedState,errorCategory:expectedCategory,count:1}])
  outcomes.push({state:expectedState,errorCategory:expectedCategory,savedReplies:receipt.savedReplies})
 }
 const after=await counts();assert.equal(after.messages-before.messages,2);assert.equal(after.deliveries-before.deliveries,2);assert.equal(after.customerMessages,before.customerMessages)
 console.log('C2 saved replies with failed or uncertain delivery',JSON.stringify(outcomes))
}
