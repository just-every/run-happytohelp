import assert from 'node:assert/strict'

// The received customer's one thread is answered by the assistant, scoped API
// and human Send in order. Only human Send can adopt unproven reply preferences.
export async function replyAuthority({app,p,owner,inbound,gateway,conversationId,fixture}){
 const aiContent='Your replacement ships tomorrow.'
 fixture.model=()=>aiContent
 await app.configure({OPENAI_API_KEY:'synthetic-mail-reply-model'})
 await app.db.prepare("INSERT INTO ai_profiles(id,project_id,name,role,prompt,model,created_at) VALUES('mail-authority-ai',?,'Assistant','support','Answer customer delivery questions.','gpt-5.6-luna',1)").bind(p).run()
 const captured=()=>fixture.sent.map(e=>e.body)
 const replies=(from,content)=>captured().slice(from).filter(body=>body.text?.includes(content)).flatMap(body=>body.to)
 const received=(await app.call('/api/integrations/email/inbound',{headers:{Authorization:'Bearer '+gateway},body:{messageId:'ai-mail-proof',to:inbound,from:'customer@example.com',replyTo:'ai-preference@example.net',cc:['ai-unproven-cc@example.net'],text:'When does order 4827 ship?'},status:201})).data
 const id=received.conversationId;assert.equal(id,conversationId,'the same customer continues the existing mail thread')
 await app.scheduled()
 await app.ok(`/api/dashboard/projects/${p}/conversations/${id}/actions`,{token:owner,body:{action:'assignAi',data:{ai_id:'mail-authority-ai'}}})
 await app.drainJobs();await app.scheduled()
 assert.equal((await app.sql("SELECT id FROM messages WHERE conversation_id=? AND actor_role='ai'",id)).length,1)
 assert.deepEqual(replies(0,aiContent),['customer@example.com'])
 const issued=await app.call(`/api/management/projects/${p}/connections/tokens`,{token:owner,body:{name:'Reply integration',scopes:['messages:write']},status:201})
 const current=await app.first('SELECT revision FROM conversations WHERE id=?',id),apiStart=captured().length,apiContent='The shipment is confirmed.'
 await app.call(`/api/v1/conversations/${id}/messages`,{token:issued.data.token,body:{localId:'api-mail-proof',content:apiContent,expectedRevision:current.revision},status:200});await app.scheduled()
 assert.deepEqual(replies(apiStart,apiContent),['customer@example.com'],'API replies cannot inherit human Reply-To authority')
 const humanStart=captured().length,head=await app.first('SELECT revision FROM conversations WHERE id=?',id),humanContent='I checked your order personally.'
 await app.call(`/api/conversations/${id}/messages`,{token:owner,body:{localId:'human-mail-proof',content:humanContent,expectedRevision:head.revision},status:200});await app.scheduled()
 assert.deepEqual(replies(humanStart,humanContent).sort(),['ai-preference@example.net','ai-unproven-cc@example.net'].sort())
}
