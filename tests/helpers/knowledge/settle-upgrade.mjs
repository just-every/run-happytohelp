import assert from 'node:assert/strict';

// Old-schema fixtures finish the real queue upgrade before exercising their
// unrelated APIs. No completion flag or canonicalisation receipt is fabricated.
export async function settleKnowledgeUpgrades(runtime,db){
 const pending=(await db.prepare('SELECT project_id FROM knowledge_upgrade_reports WHERE completed_at IS NULL').all()).results;
 if(!pending.length)return;
 const queue=await runtime.getQueueProducer('JOBS');
 for(const {project_id:projectId} of pending)await queue.send({type:'knowledge.upgrade',id:projectId,projectId});
 const deadline=Date.now()+60000;
 while((await db.prepare('SELECT count(*) n FROM knowledge_upgrade_reports WHERE completed_at IS NULL').first()).n){
  assert.ok(Date.now()<deadline,'historical knowledge conversion completes through the real queue');
  await new Promise(done=>setTimeout(done,100));
 }
}
