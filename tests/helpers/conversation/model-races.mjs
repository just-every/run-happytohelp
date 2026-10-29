import assert from 'node:assert/strict'
import {assistantApp} from '../ai/app.mjs'

// Only the paid provider response is held. Every competing write uses the
// real router, generation consumer and atomic D1 admission writer.
export async function modelWriterRaces(){
 const a=await assistantApp(),{app,owner,p,ai}=a
 const generations=async id=>(await app.call(`/api/ai-support/projects/${p}/conversations/${id}/trace`,{token:owner,status:200})).data.generations
 try{
  await app.presenceAwayOff(p)
  for(const winner of ['operator','visitor','model']){
   const visitor=await a.visitor(),path=`/api/conversations/${visitor.conversationId}/messages`
   await visitor.say('Please help with my order')
   const before=await visitor.transcript(),generationId=(await generations(visitor.conversationId))[0].id
   const jobs=(await app.takeJobs()).filter(job=>job.type==='ai.generate'&&job.id===generationId)
   assert.equal(jobs.length,1)
   const entered=Promise.withResolvers(),release=Promise.withResolvers()
   ai.respond=async()=>{entered.resolve();await release.promise;return 'Model final reply'}
   const calls=a.providerCalls(),running=a.run(jobs)
   try{
    await Promise.race([entered.promise,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('model did not reach provider')),10000);timer.unref()})])
    await a.run(jobs) // Concurrent redelivery cannot acquire a second running attempt.
    assert.equal(a.providerCalls(),calls+1)
    assert.equal((await generations(visitor.conversationId))[0].state,'running','redelivery must preserve the live writer until guarded final admission')
    const command={localId:`${winner}-final`,content:`${winner} final reply`,expectedRevision:before.revision,expectedLastMessageId:before.lastMessageId,resolve:winner==='operator'}
    if(winner!=='model'){
     const token=winner==='visitor'?visitor.token:owner
     assert.equal((await app.call(path,{token,body:command,status:200})).data.accepted,true)
     assert.equal((await app.call(path,{token,body:command,status:200})).data.duplicate,true)
    }
    release.resolve();await running
    if(winner==='model')assert.equal((await app.call(path,{token:owner,body:command,status:409})).data.accepted,false,'the stale operator cannot add an incompatible final after the model wins')
    const after=await visitor.transcript()
    assert.equal(after.revision,2)
    assert.deepEqual(after.messages.map(m=>[m.actor_role,m.content,m.revision]),[
     ['contact','Please help with my order',1],
     [winner==='model'?'ai':winner==='visitor'?'contact':'owner',winner==='model'?'Model final reply':command.content,2],
    ])
    assert.equal(after.lastMessageId,after.messages[1].id)
    const generation=(await generations(visitor.conversationId)).find(row=>row.id===generationId)
    assert.equal(generation.state,winner==='model'?'completed':winner==='visitor'?'superseded':'cancelled')
    if(winner==='model')assert.equal(after.messages[1].local_id,`generation:${generation.id}`)
    await a.run(jobs)
    assert.equal(a.providerCalls(),calls+1,'completed, cancelled and superseded work never calls the model again')
    assert.deepEqual(await visitor.transcript(),after,'queue replay preserves the exact admitted identity/frontier')
   }finally{release.resolve();await running}
  }

  // Two distinct generation commands share a revision and produce incompatible
  // answers concurrently. The final writer's atomic frontier admits only one.
  {
   const visitor=await a.visitor();await visitor.say('Choose one final answer')
   await app.call(`/api/ai-support/projects/${p}/conversations/${visitor.conversationId}/generations`,{token:owner,body:{expectedRevision:1},status:202})
   const issued=await generations(visitor.conversationId),ids=new Set(issued.map(g=>g.id))
   assert.equal(ids.size,2)
   const jobs=(await app.takeJobs()).filter(job=>job.type==='ai.generate'&&ids.has(job.id))
   assert.equal(jobs.length,2)
   let entered=0;const ready=Promise.withResolvers(),release=Promise.withResolvers(),calls=a.providerCalls()
   ai.respond=async()=>{const reply=++entered===1?'Refund approved':'Refund refused';if(entered===2)ready.resolve();await release.promise;return reply}
   const running=Promise.all(jobs.map(job=>a.run([job])))
   try{
    await Promise.race([ready.promise,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('both model writers must reach the provider')),10000);timer.unref()})])
    release.resolve();await running
    const transcript=await visitor.transcript(),answers=transcript.messages.filter(m=>m.actor_role==='ai')
    assert.equal(answers.length,1);assert.equal(transcript.revision,2);assert.equal(transcript.lastMessageId,answers[0].id)
    assert.ok(['Refund approved','Refund refused'].includes(answers[0].content))
    assert.deepEqual((await generations(visitor.conversationId)).map(g=>g.state).sort(),['completed','superseded'])
    await a.run(jobs);assert.equal(a.providerCalls(),calls+2);assert.deepEqual(await visitor.transcript(),transcript)
   }finally{release.resolve();await running}
  }
 }finally{await a.close()}
}
