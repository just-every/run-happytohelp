import assert from 'node:assert/strict'
import {harness} from './harness.mjs'

async function seedQuestions(h){await h.db.prepare("INSERT INTO messages(id,project_id,conversation_id,local_id,actor_id,actor_role,content,revision,created_at) SELECT 'question-'||id,project_id,id,'question-'||id,contact_id,'contact','Question',1,created_at FROM conversations").run()}

export async function reportScaleJourney(){
 const h=await harness();try{
  await h.contact();
  const path='/api/dashboard/projects/p/reports?period=custom&start=2026-04-01&end=2026-04-02';
  const empty=await h.raw(path+'&format=summary.csv');assert.equal(empty.status,200);await empty.text();
  await h.db.prepare("WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<10001) INSERT INTO conversations(id,project_id,contact_id,created_at,updated_at) SELECT printf('bulk-%05d',i),'p','visitor',1775001600000,1775001600000 FROM n").run();await seedQuestions(h);
  const response=await h.raw(path),report=await response.json();assert.equal(response.status,200);assert.equal(report.volume,10001);
  const detail=await h.raw(path+'&format=conversations.csv'),csv=await detail.text();
  assert.equal((csv.match(/"bulk-\d{5}"/g)||[]).length,10001);assert.match(csv,/"bulk-10001"/);
  const historyResponse=await h.raw(path+'&format=transcripts.json'),history=await historyResponse.json();
  assert.equal(historyResponse.status,200);assert.equal(history.conversations.length,10001,'complete history exports every conversation beyond 10,000');
  assert.equal(history.conversations.find(row=>row.id==='bulk-10001').messages.length,1);
  const result=await h.raw(path+'&format=summary.csv'),summary=await result.text();
  assert.equal(result.status,200);assert.match(summary,/"Conversations","10001"/);assert.match(summary,/"2026-04-01","10001","0","0","0","0"/);
  assert.doesNotMatch(summary,/bulk-|"ID","Created|Latest comment/);
  assert.equal(h.external,0);
 }finally{await h.close()}
}
