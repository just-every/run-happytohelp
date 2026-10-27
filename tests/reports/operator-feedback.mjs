import {runSteps} from '../journeys/kit/steps.mjs';
import {phases} from '../journeys/kit/scenarios.mjs';
const test=phases(import.meta.url);
import assert from 'node:assert/strict';
import {harness,json} from './harness.mjs';

test("operator feedback lifecycle: retain prior cycles only under current workspace authority",()=>runSteps([
  ['operator retains latest feedback for every prior resolution while visitor eligibility stays current',async()=>{
 const h=await harness();try{
  await h.contact();const c=await h.conversation(),path='/api/dashboard/projects/p/conversations/'+c.id;
  const operator=async()=>(await h.call(path)).data;
  const visitor=()=>h.call('/api/conversations/'+c.id+'/messages',{actor:'visitor'});
  const rate=(id,value,comment)=>h.call('/api/conversations/'+c.id+'/widget-events',{...json({action:'rateResolution',data:{resolutionId:id,value,comment}}),actor:'visitor'});
  await h.send(c.id,'First answer',{kind:'human'},'owner',true);
  const first=(await visitor()).resolution;await rate(first.id,1,'Initial feedback');await rate(first.id,-1,'Needs more detail');
  await h.send(c.id,'Please explain further',null,'visitor');
  let view=await operator();assert.equal(view.resolution,null);assert.equal((await visitor()).resolution,null);
  assert.deepEqual(view.resolutionHistory.map(r=>[r.id,r.ordinal,r.outcome,r.rating.value,r.rating.comment,r.rating.revision]),[[first.id,1,'human',-1,'Needs more detail',2]]);
  assert.ok(view.resolutionHistory[0].reopenedAt);assert.equal('resolutionHistory' in await visitor(),false,'visitor transcript has no past feedback projection');
  assert.equal((await h.raw('/api/conversations/'+c.id+'/widget-events',{...json({action:'rateResolution',data:{resolutionId:first.id,value:1}}),actor:'visitor'})).status,409);
  await h.send(c.id,'Second answer',{kind:'human'},'owner',true);const second=(await visitor()).resolution;await rate(second.id,1,'Now clear');
  view=await operator();assert.equal(view.resolution.id,second.id);assert.equal(view.resolution.rating.comment,'Now clear');assert.deepEqual(view.resolutionHistory.map(r=>r.id),[first.id]);
  await h.send(c.id,'Another question',null,'visitor');view=await operator();assert.equal(view.resolution,null);assert.deepEqual(view.resolutionHistory.map(r=>[r.ordinal,r.rating.comment]),[[2,'Now clear'],[1,'Needs more detail']]);
  const changes=(await h.db.prepare('SELECT comment FROM conversation_rating_history WHERE resolution_id=? ORDER BY revision').bind(first.id).all()).results;assert.deepEqual(changes.map(r=>r.comment),['Initial feedback','Needs more detail']);
  await h.call('/api/management/projects/p/contacts/visitor/erase',json({}));view=await operator();assert.deepEqual(view.resolutionHistory.map(r=>r.rating.comment),['','']);assert.equal((await h.db.prepare("SELECT COUNT(*) n FROM conversation_rating_history WHERE comment<>''").first()).n,0);
  assert.equal(h.external,0);
 }finally{await h.close()}
}],
  ['operator feedback reads require current native workspace authority',async()=>{
 const h=await harness();try{
  await h.contact();const c=await h.conversation();await h.send(c.id,'Answer',{kind:'human'},'owner',true);await h.send(c.id,'Reopen',null,'visitor');
  const path='/api/dashboard/projects/p/conversations/'+c.id;
  assert.equal((await h.raw(path,{actor:'visitor'})).status,403);
  for(const prefix of ['/api/dashboard/projects/p/conversations/','/api/dashboard/projects/q/conversations/','/api/dashboard/conversations/'])assert.equal((await h.raw(prefix+c.id,{actor:'foreign'})).status,404);
  await h.db.prepare("INSERT INTO memberships VALUES('p','foreign','operator')").run();assert.equal((await h.call(path,{actor:'foreign'})).data.resolutionHistory.length,1,'active cross-workspace member can read');
  await h.db.prepare("DELETE FROM memberships WHERE project_id='p' AND user_id='foreign'").run();assert.equal((await h.raw(path,{actor:'foreign'})).status,404);
  await h.db.prepare('UPDATE sessions SET revoked_at=1 WHERE token_hash=?').bind(h.tokenHash('owner')).run();assert.equal((await h.raw(path)).status,401);await h.session('owner','p','owner','owner');
  await h.db.prepare("INSERT INTO memberships VALUES('p','foreign','operator')").run();await h.db.prepare("INSERT INTO project_settings(project_id,settings_json,updated_at) VALUES('p','{\"deleted_at\":1}',1) ON CONFLICT(project_id) DO UPDATE SET settings_json=excluded.settings_json").run();assert.equal((await h.raw(path,{actor:'foreign'})).status,404,'retained membership does not authorize a deleted target');
 }finally{await h.close()}
}]
]));
