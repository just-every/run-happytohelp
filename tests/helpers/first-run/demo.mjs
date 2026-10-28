import assert from 'node:assert/strict'

// The owner's sample desk is separate from the newly provisioned live workspace.
export async function demoOnboarding(app,owner,foreign){
 const before=await app.first('SELECT count(*) n FROM conversations WHERE project_id=?',owner.projectId)
 const create=status=>app.call('/api/dashboard/demo-inbox',{token:owner.token,body:{},status})
 const demo=(await create(201)).data;assert.equal((await create(200)).data.id,demo.id)
 assert.equal((await app.call('/api/dashboard/demo-inbox',{token:foreign.tokens.operator,body:{}})).status,403)
 const stories=(await app.call(`/api/dashboard/projects/${demo.id}/conversations?view=all`,{token:owner.token,status:200})).data.data
 assert.ok(stories.length>0)
 const rich=await app.first('SELECT n.conversation_id FROM conversation_notes n JOIN conversations c ON c.id=n.conversation_id WHERE c.project_id=? LIMIT 1',demo.id)
 const path=`/api/dashboard/projects/${demo.id}/conversations/${rich.conversation_id}/buckets`
 const buckets=(await app.call(path,{token:owner.token,status:200})).data.data
 assert.ok(buckets.flatMap(bucket=>bucket.messages).length>0)
 assert.ok(buckets.flatMap(bucket=>bucket.events).some(event=>event.type==='INTERNAL_NOTE'))
 assert.ok(buckets.flatMap(bucket=>bucket.events).some(event=>event.type==='PAGE_VIEW'))
 assert.equal((await app.call(path,{token:foreign.tokens.owner})).status,404)
 const articles=(await app.call(`/api/knowledge/public/${demo.id}/articles`,{status:200})).data
 assert.ok(articles.length>0)
 assert.deepEqual(await app.first('SELECT count(*) n FROM conversations WHERE project_id=?',owner.projectId),before)
 assert.equal((await app.first('SELECT count(*) n FROM ai_generations WHERE project_id=?',demo.id)).n,0)
 return demo.id
}
