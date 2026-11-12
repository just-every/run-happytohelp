import assert from 'node:assert/strict'
export async function boundedOriginPages(h){
 const root='/api/move-in/projects/p/zendesk/diagnostics/articles'
 // More than one maximum-sized page, with duplicate source IDs and absent
 // targets. Removing an earlier row must not shift the continuation past one.
 const origins=Array.from({length:95},(_,i)=>`synthetic-census-page-${i}`)
 await h.db.batch(origins.map(id=>h.db.prepare("INSERT INTO move_in_origins VALUES('p','article',?,'zendesk','9999','{}','1')").bind(id)))
 try{
  const defaultPage=(await h.call(root)).data
  assert.equal(defaultPage.rows.length,50);assert.ok(defaultPage.nextCursor)
  const first=(await h.call(root+'?limit=90')).data
  assert.equal(first.rows.length,90);assert.ok(first.nextCursor)
  await h.db.prepare("DELETE FROM move_in_origins WHERE project_id='p' AND target_kind='article' AND target_id=?").bind(origins[0]).run()
  const rest=(await h.call(root+'?'+new URLSearchParams({limit:'90',cursor:first.nextCursor}))).data
  assert.equal(first.rows.length+rest.rows.length,97,'earlier deletion cannot silently skip a duplicate')
  assert.equal(rest.nextCursor,null)
  assert.equal([...first.rows,...rest.rows].filter(row=>row.sourceId==='9999').length,95)
  for(const cursor of [first.nextCursor+'=',Buffer.from(JSON.stringify({v:2,project:'synthetic-wrong',kind:'articles',after:'1'})).toString('base64url')]){
   const result=await h.raw(root+'?'+new URLSearchParams({cursor}))
   assert.equal(result.response.status,400);assert.equal(result.response.headers.get('Cache-Control'),'no-store')
  }
 }finally{await h.db.batch(origins.map(id=>h.db.prepare("DELETE FROM move_in_origins WHERE project_id='p' AND target_kind='article' AND target_id=?").bind(id)))}
}
