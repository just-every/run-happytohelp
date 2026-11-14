import assert from 'node:assert/strict'
import {reportProjectionRebuildSql} from '../../scripts/installer/reports-rebuild.mjs'

export async function assertReportProjection(db){
 const {results:direct}=await db.prepare(`SELECT c.id conversation_id,c.project_id,c.created_at,c.status_category FROM conversations c
  WHERE EXISTS(SELECT 1 FROM messages m WHERE m.project_id=c.project_id AND m.conversation_id=c.id) ORDER BY c.id`).all()
 const {results:projected}=await db.prepare('SELECT * FROM reporting_conversations ORDER BY conversation_id').all()
 assert.deepEqual(projected,direct,'the report cohort projection equals the direct computation across every workspace')
 const source=`SELECT c.project_id,c.id conversation_id,d.value dimension,CASE WHEN d.value='tag' THEN COALESCE(ct.tag_id,'') ELSE '' END item_id,
  CASE d.value WHEN 'agent' THEN c.assigned_to WHEN 'team' THEN c.group_id WHEN 'channel' THEN c.channel WHEN 'brand' THEN COALESCE(c.brand_id,c.project_id) WHEN 'account' THEN a.id ELSE t.id END item_key,
  json_array(c.group_id,COALESCE(c.brand_id,c.project_id),CASE WHEN EXISTS(SELECT 1 FROM move_in_conversations m WHERE m.project_id=c.project_id AND m.conversation_id=c.id) OR EXISTS(SELECT 1 FROM reporting_legacy_conversations l WHERE l.project_id=c.project_id AND l.conversation_id=c.id) THEN 1 ELSE 0 END) scope_key,
  c.group_id team_id,COALESCE(c.brand_id,c.project_id) brand_id,
  CASE WHEN EXISTS(SELECT 1 FROM move_in_conversations m WHERE m.project_id=c.project_id AND m.conversation_id=c.id) OR EXISTS(SELECT 1 FROM reporting_legacy_conversations l WHERE l.project_id=c.project_id AND l.conversation_id=c.id) THEN 1 ELSE 0 END imported,
  c.created_at,c.status_category
  FROM conversations c CROSS JOIN json_each('["agent","team","channel","brand","account","tag"]') d
  LEFT JOIN contact_companies cc ON d.value='account' AND cc.project_id=c.project_id AND cc.contact_id=c.contact_id
  LEFT JOIN companies a ON a.project_id=cc.project_id AND a.id=cc.company_id AND a.merged_into IS NULL
  LEFT JOIN conversation_tags ct ON d.value='tag' AND ct.project_id=c.project_id AND ct.conversation_id=c.id
  LEFT JOIN workspace_tags t ON t.project_id=ct.project_id AND t.id=ct.tag_id
  WHERE EXISTS(SELECT 1 FROM messages m WHERE m.project_id=c.project_id AND m.conversation_id=c.id)
  AND NOT EXISTS(SELECT 1 FROM conversation_merges m WHERE m.project_id=c.project_id AND m.source_id=c.id AND m.undone_at IS NULL)`
 const items='project_id,conversation_id,dimension,item_id,item_key,scope_key,team_id,brand_id,imported,created_at,status_category'
 const keys='project_id,scope_key,key_id,dimension,item_key,team_id,brand_id,imported,first_created_at,items'
 for(const [table,columns,expected] of [
  ['reporting_workload_items',items,`SELECT ${items} FROM direct`],
  ['reporting_workload_keys',keys,`SELECT project_id,scope_key,json_array(dimension,item_key),dimension,item_key,team_id,brand_id,imported,MIN(created_at),COUNT(*) FROM direct GROUP BY project_id,scope_key,dimension,item_key`]
 ]){
  const result=await db.prepare(`WITH direct AS (${source}), expected AS (${expected}),
   missing AS (SELECT * FROM expected EXCEPT SELECT ${columns} FROM ${table}),
   extra AS (SELECT ${columns} FROM ${table} EXCEPT SELECT * FROM expected)
   SELECT (SELECT COUNT(*) FROM missing)+(SELECT COUNT(*) FROM extra) differences`).first()
  assert.equal(result.differences,0,table+' equals direct current attributes, import/merge scope and lifetime bucket presence')
 }

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
 const group=await h.call('/api/dashboard/projects/p/ticket-groups',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Projection team',members:['owner']})})
 await h.db.prepare("UPDATE conversations SET assigned_to='owner',group_id=?,brand_id='historical-brand',channel='email' WHERE id='projection-mutations'").bind(group.data.id).run()
 await h.call('/api/dashboard/projects/p/conversations/projection-mutations/tags',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Projection tag'})})
 await assertReportProjection(h.db)
 const company=await h.call('/api/dashboard/projects/p/companies',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Projection account'})})
 await h.call('/api/dashboard/projects/p/companies/'+company.company.id+'/members/visitor',{method:'PUT',headers:{'Content-Type':'application/json'},body:'{}'})
 await assertReportProjection(h.db)
 await h.call('/api/dashboard/projects/p/companies/'+company.company.id+'/members/visitor',{method:'DELETE'})
 await assertReportProjection(h.db)
 await h.db.prepare("INSERT INTO conversation_merges(id,project_id,source_id,target_id,actor_id,created_at,source_version,target_version,source_revision,target_revision) VALUES('projection-merge','p','projection-mutations','a','owner',?,0,0,2,2)").bind(at).run()
 await assertReportProjection(h.db)
 assert.equal((await h.call(path)).volume,before.volume)
 await h.db.prepare("UPDATE conversation_merges SET undone_at=? WHERE id='projection-merge'").bind(at+1000).run()
 await assertReportProjection(h.db)

 assert.equal((await h.call(path)).volume,before.volume+1)
 await h.db.prepare("UPDATE conversations SET created_at=?,status_category='solved',resolved_at=? WHERE id='projection-mutations'").bind(at-864000000,at).run()
 await assertReportProjection(h.db)
 assert.equal((await h.call(path)).volume,before.volume)
 const historical=await h.call(path.replace('/reports?','/reports/team?'))
 const emptyBucket=historical.workload.team.find(row=>row.id===group.data.id)
 assert.deepEqual([emptyBucket.incoming,emptyBucket.resolved,emptyBucket.backlog],[0,0,0],'older closed tickets retain their historical empty bucket')
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
 const beforeRebuild=await h.call(path)
 await h.db.batch(reportProjectionRebuildSql.split(';').map(sql=>sql.trim()).filter(Boolean).map(sql=>h.db.prepare(sql)))
 await assertReportProjection(h.db)
 assert.deepEqual(await h.call(path),beforeRebuild,'the restore rebuild retains every report figure')

}
