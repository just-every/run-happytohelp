import assert from 'node:assert/strict'

export async function assertReportProjection(db){
 const {results:direct}=await db.prepare(`SELECT c.id conversation_id,c.project_id,c.created_at,c.status_category FROM conversations c
  WHERE EXISTS(SELECT 1 FROM messages m WHERE m.project_id=c.project_id AND m.conversation_id=c.id) ORDER BY c.id`).all()
 const {results:projected}=await db.prepare('SELECT * FROM reporting_conversations ORDER BY conversation_id').all()
 assert.deepEqual(projected,direct,'the report cohort projection equals the direct computation across every workspace')
}

// Historical fixtures need database writes for old instants. Keep the existing
// public calendar/export oracle registration and exercise projection mutations
// beside it, including deleting the last message and adding one again.
export async function projectionMutations(h,path){
 const before=await h.call(path),at=Date.parse('2026-03-08T12:00:00Z')
 await h.db.prepare("INSERT INTO conversations(id,project_id,contact_id,created_at,updated_at) VALUES('projection-mutations','p','visitor',?,?)").bind(at,at).run()
 await assertReportProjection(h.db)
 assert.equal((await h.call(path)).volume,before.volume)
 const message=(id,revision)=>h.db.prepare("INSERT INTO messages(id,project_id,conversation_id,local_id,actor_id,actor_role,content,revision,created_at) VALUES(?,'p','projection-mutations',?,'visitor','contact','Projection question',?,?)").bind(id,id,revision,at).run()
 await message('projection-first',1);await message('projection-second',2)
 await assertReportProjection(h.db)
 assert.equal((await h.call(path)).volume,before.volume+1)
 await h.db.prepare("UPDATE conversations SET created_at=?,status_category='solved',resolved_at=? WHERE id='projection-mutations'").bind(at-864000000,at).run()
 await assertReportProjection(h.db)
 assert.equal((await h.call(path)).volume,before.volume)
 await h.db.prepare("UPDATE conversations SET created_at=?,status_category='open',resolved_at=NULL WHERE id='projection-mutations'").bind(at).run()
 await assertReportProjection(h.db)
 await h.db.prepare("DELETE FROM messages WHERE id='projection-first'").run()
 await assertReportProjection(h.db)
 assert.equal((await h.call(path)).volume,before.volume+1)
 await h.db.prepare("DELETE FROM messages WHERE id='projection-second'").run()
 await assertReportProjection(h.db)
 assert.equal((await h.call(path)).volume,before.volume)
 await message('projection-returned',3)
 await assertReportProjection(h.db)
 assert.equal((await h.call(path)).volume,before.volume+1)
 await h.db.prepare("DELETE FROM messages WHERE id='projection-returned'").run()
 await assertReportProjection(h.db)
}
