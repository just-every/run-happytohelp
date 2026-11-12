import assert from 'node:assert/strict'
import {nativeSnapshot} from './snapshot.mjs'
const root='/api/move-in/projects/p/zendesk/diagnostics'
export async function linkageObservations(h){
 const original=await nativeSnapshot(h),first=original.tickets.find(row=>row.sourceId==='101'),last=original.tickets.find(row=>row.sourceId==='107')
 // Broken cross-project references remain counted, but their native IDs and
 // dependent counts are concealed. Restore each synthetic fault before continuing.
 await h.db.prepare("UPDATE conversations SET project_id='q' WHERE id=?").bind(first.conversationId).run()
 try{
  const broken=await nativeSnapshot(h),row=broken.tickets.find(row=>row.sourceId==='101')
  assert.deepEqual(row,{sourceId:'101',conversationId:null,nativePresent:false,messageCount:0,noteCount:0,contactLinked:false})
  assert.equal(broken.summary.mappingRows,original.summary.mappingRows)
  assert.doesNotMatch(JSON.stringify(broken),new RegExp(first.conversationId))
 }finally{await h.db.prepare("UPDATE conversations SET project_id='p' WHERE id=?").bind(first.conversationId).run()}
 const contact=(await h.db.prepare('SELECT contact_id FROM conversations WHERE id=?').bind(first.conversationId).first()).contact_id
 await h.db.prepare("UPDATE contacts SET project_id='q' WHERE id=?").bind(contact).run()
 try{assert.equal((await nativeSnapshot(h)).tickets.find(row=>row.sourceId==='101').contactLinked,false)}finally{await h.db.prepare("UPDATE contacts SET project_id='p' WHERE id=?").bind(contact).run()}
 await h.db.prepare("UPDATE move_in_conversations SET source_id='101' WHERE conversation_id=?").bind(last.conversationId).run()
 try{
  const duplicate=await nativeSnapshot(h,'p',1)
  assert.ok(duplicate.complete);assert.equal(duplicate.summary.duplicateSourceGroups,1)
  assert.equal(duplicate.summary.mappingRows,duplicate.summary.distinctSourceIds+1)
  assert.equal(duplicate.tickets.filter(row=>row.sourceId==='101').length,2,'paging retains every duplicate')
 }finally{await h.db.prepare("UPDATE move_in_conversations SET source_id='107' WHERE conversation_id=?").bind(last.conversationId).run()}
 await h.db.batch([
  h.db.prepare("INSERT INTO move_in_origins VALUES('p','article','synthetic-missing-article','zendesk','9991','{}','1')"),
  h.db.prepare("INSERT INTO knowledge_articles(id,project_id,slug,title,content,status,updated_at) VALUES('synthetic-foreign-target','q','synthetic-hh-foreign','Synthetic foreign guide','Synthetic content','published',1)"),
  h.db.prepare("INSERT INTO move_in_origins VALUES('p','article','synthetic-foreign-target','zendesk','9992','{}','1')"),
  h.db.prepare("INSERT INTO move_in_origins VALUES('p','article','synthetic-other-vendor','intercom','9993','{}','1')"),
  h.db.prepare("INSERT INTO move_in_origins VALUES('q','article','synthetic-q-one','zendesk','9994','{}','1')"),
  h.db.prepare("INSERT INTO move_in_origins VALUES('q','article','synthetic-q-two','zendesk','9995','{}','1')")])
 try{
  const broken=await nativeSnapshot(h,'p',1)
  assert.equal(broken.summary.articleOrigins,original.summary.articleOrigins+2)
  assert.equal(broken.summary.publishedArticleOrigins,original.summary.publishedArticleOrigins)
  assert.equal(broken.summary.draftArticleOrigins,original.summary.draftArticleOrigins)
  assert.deepEqual(broken.articles.filter(row=>['9991','9992'].includes(row.sourceId)),['9991','9992'].map(sourceId=>({sourceId,articleId:null,nativePresent:false,status:null})))
  assert.ok(!broken.articles.some(row=>['9993','9994','9995'].includes(row.sourceId)))
  assert.doesNotMatch(JSON.stringify(broken),/synthetic-foreign-target/)
  const foreign=(await h.call('/api/move-in/projects/q/zendesk/diagnostics/articles?limit=1',{actor:'foreign'})).data.nextCursor
  assert.ok(foreign)
  for(const [kind,cursor] of [['articles',foreign],['tickets',broken.cursors.articles[1]]]){
   const refused=await h.raw(`${root}/${kind}?${new URLSearchParams({cursor})}`)
   assert.equal(refused.response.status,400);assert.equal(refused.response.headers.get('Cache-Control'),'no-store')
   assert.doesNotMatch(JSON.stringify(refused.data),/9994|9995|synthetic-q/)
  }
 }finally{
  await h.db.prepare("DELETE FROM move_in_origins WHERE target_id IN ('synthetic-missing-article','synthetic-foreign-target','synthetic-other-vendor','synthetic-q-one','synthetic-q-two')").run()
  await h.db.prepare("DELETE FROM knowledge_articles WHERE id='synthetic-foreign-target'").run()
 }
}
