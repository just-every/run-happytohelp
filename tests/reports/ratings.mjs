import {phases} from '../journeys/kit/scenarios.mjs';
const test=phases(import.meta.url);
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {harness,json} from './harness.mjs';
test('ratings follow current original-contact sessions, resolution cycles, changes and erasure',async()=>{const h=await harness();try{
 await configurableRatings();
 await h.contact();await h.contact('other');await h.contact('outsider','q');const c=await h.conversation();await h.send(c.id,'Question',null,'visitor');await h.send(c.id,'Answer',{kind:'human'},'owner',true);
 const get=()=>h.call('/api/conversations/'+c.id+'/messages',{actor:'visitor'}),resolution=(await get()).resolution;assert.equal(resolution.outcome,'human');assert.equal(resolution.rating,null);
 const rate=(data,actor='visitor')=>h.raw('/api/conversations/'+c.id+'/widget-events',{...json({action:'rateResolution',data}),actor});
 assert.equal((await rate({resolutionId:resolution.id,value:1})).status,200,'comment is optional');assert.deepEqual((await get()).resolution.rating.comment,'');assert.equal((await get()).resolution.rating.recovery,'unknown','positive satisfaction alone establishes no recovery');
 assert.equal((await rate({resolutionId:resolution.id,value:-1,recovery:'not_recovered',comment:'Please clarify'})).status,200);assert.equal((await get()).resolution.rating.recovery,'not_recovered');assert.equal((await get()).resolution.rating.revision,2);assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM conversation_rating_history').first()).n,2);
 for(const actor of ['owner','other','outsider'])assert.ok([403,404].includes((await rate({resolutionId:resolution.id,value:1},actor)).status));
 for(const data of [{value:0},{value:1,recovery:true},{value:1,comment:5},{value:1,comment:'x'.repeat(1001)}])assert.equal((await rate({resolutionId:resolution.id,...data})).status,400);
 await h.db.prepare('UPDATE sessions SET revoked_at=1 WHERE token_hash=?').bind(h.tokenHash('visitor')).run();assert.equal((await rate({resolutionId:resolution.id,value:1})).status,401);await h.session('visitor','p','visitor');
 await h.db.prepare('UPDATE sessions SET expires_at=1 WHERE token_hash=?').bind(h.tokenHash('visitor')).run();assert.equal((await rate({resolutionId:resolution.id,value:1})).status,401);await h.session('visitor','p','visitor');
 await h.db.prepare("UPDATE contacts SET metadata_json='{\"is_blocked\":true}' WHERE id='visitor'").run();assert.equal((await rate({resolutionId:resolution.id,value:1})).status,401);await h.db.prepare("UPDATE contacts SET metadata_json='{}' WHERE id='visitor'").run();
 await h.db.prepare("UPDATE conversations SET contact_id='other' WHERE id=?").bind(c.id).run();assert.equal((await rate({resolutionId:resolution.id,value:1},'other')).status,409,'a changed conversation owner cannot rate the original resolution');await h.db.prepare("UPDATE conversations SET contact_id='visitor' WHERE id=?").bind(c.id).run();
 await h.transition(c.id,{resolved:false});assert.equal((await get()).resolution,null);assert.equal((await rate({resolutionId:resolution.id,value:1})).status,409);await h.send(c.id,'Followup',null,'visitor');await h.send(c.id,'Second answer',{kind:'human'},'owner',true);const next=(await get()).resolution;assert.equal(next.ordinal,2);assert.notEqual(next.id,resolution.id);assert.equal(next.rating,null);assert.equal((await rate({resolutionId:resolution.id,value:1})).status,409);assert.equal((await rate({resolutionId:next.id,value:1,comment:'Solved'})).status,200);
 await h.call('/api/management/projects/p/contacts/visitor/erase',json({}));assert.equal((await h.db.prepare("SELECT COUNT(*) n FROM conversation_ratings WHERE comment<>''").first()).n,0);assert.equal((await h.db.prepare("SELECT COUNT(*) n FROM conversation_rating_history WHERE comment<>''").first()).n,0);assert.equal((await rate({resolutionId:next.id,value:1})).status,401);assert.equal(h.external,0)
 }finally{await h.close()}});
test('rating commands share persistent visitor rate limits',async()=>{const h=await harness();try{await h.contact();const c=await h.conversation();await h.send(c.id,'answer',{kind:'human'},'owner',true);const resolution=(await h.call('/api/conversations/'+c.id+'/messages',{actor:'visitor'})).resolution;const now=Math.floor(Date.now()/60000)*60000;await h.db.prepare("INSERT INTO abuse_counters(key,window_start,used,expires_at) VALUES(?,?,120,?)").bind('rate:widgetEventsPerContactMinute:'+createHash('sha256').update('visitor').digest('hex'),now,now+60000).run();const response=await h.raw('/api/conversations/'+c.id+'/widget-events',{...json({action:'rateResolution',data:{resolutionId:resolution.id,value:1}}),actor:'visitor'});assert.equal(response.status,429);assert.ok(response.headers.get('Retry-After'));assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM conversation_ratings').first()).n,0)}finally{await h.close()}});
test('rating commit rechecks visitor contact and session authority after initial access',async()=>{for(const sql of ["UPDATE sessions SET revoked_at=1 WHERE contact_id='visitor'","UPDATE sessions SET expires_at=1 WHERE contact_id='visitor'","UPDATE contacts SET metadata_json='{\"is_blocked\":true}' WHERE id='visitor'","UPDATE conversations SET contact_id='other' WHERE id=?","UPDATE conversations SET resolved_at=NULL,updated_at=updated_at+1 WHERE id=?"]){const h=await harness();try{await h.contact();await h.contact('other');const c=await h.conversation();await h.send(c.id,'Answer',{kind:'human'},'owner',true);const resolution=(await h.call('/api/conversations/'+c.id+'/messages',{actor:'visitor'})).resolution;const response=await h.raw('/_test/rating-race',{...json({id:c.id,data:{resolutionId:resolution.id,value:1},sql,args:sql.includes('?')?[c.id]:[]}),actor:'visitor'});assert.equal(response.status,409);assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM conversation_ratings').first()).n,0);assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM conversation_rating_history').first()).n,0)}finally{await h.close()}}});
test('original contact erasure removes rating text after conversation contact ownership changes',async()=>{const h=await harness();try{await h.contact();await h.contact('new-contact');const c=await h.conversation();await h.send(c.id,'Answer',{kind:'human'},'owner',true);const resolution=(await h.call('/api/conversations/'+c.id+'/messages',{actor:'visitor'})).resolution;await h.call('/api/conversations/'+c.id+'/widget-events',{...json({action:'rateResolution',data:{resolutionId:resolution.id,value:1,comment:'Original visitor private text'}}),actor:'visitor'});await h.db.prepare("UPDATE conversations SET contact_id='new-contact' WHERE id=?").bind(c.id).run();await h.call('/api/management/projects/p/contacts/visitor/erase',json({}));assert.equal((await h.db.prepare('SELECT comment FROM conversation_ratings WHERE resolution_id=?').bind(resolution.id).first()).comment,'');assert.equal((await h.db.prepare('SELECT comment FROM conversation_rating_history WHERE resolution_id=?').bind(resolution.id).first()).comment,'');assert.equal((await h.db.prepare("SELECT metadata_json FROM contacts WHERE id='new-contact'").first()).metadata_json,'{}')}finally{await h.close()}});


async function configurableRatings(){
 const h=await harness();try{
  await h.contact();await h.contact('other');const c=await h.conversation(),settings='/api/outcomes/projects/p/settings',events='/api/conversations/'+c.id+'/widget-events'
  const configure=body=>h.call(settings,{...json({enabled:false,widgetEnabled:true,scale:'five',locale:'es',delayMinutes:10,expiresDays:1,...body}),method:'PUT'})
  await configure({});await h.send(c.id,'Question',null,'visitor');await h.send(c.id,'Answer',{kind:'human'},'owner',true)
  const get=async()=>(await h.call('/api/conversations/'+c.id+'/messages',{actor:'visitor'})).resolution
  const first=await get(),rate=(score,comment='')=>h.raw(events,{...json({action:'rateResolution',data:{resolutionId:first.id,score,comment}}),actor:'visitor'})
  assert.equal(first.survey.scale,'five');assert.equal(first.survey.locale,'es');assert.equal(first.survey.availableAt,Date.parse(first.resolvedAt)+600000)
  assert.equal((await rate(5)).status,409,'the server refuses early feedback, even through the raw event door')
  await configure({scale:'thumbs',locale:'fr',delayMinutes:0})
  assert.equal((await get()).survey.scale,'five','settings changes preserve the existing cycle snapshot')
  await h.db.prepare("UPDATE conversation_resolutions SET evidence_json=json_set(evidence_json,'$.widgetSurvey.availableAt',0) WHERE id=?").bind(first.id).run()
  assert.equal((await rate(-1)).status,400,'a thumbs value cannot bypass a five-point cycle')
  assert.equal((await rate(2,'Needs follow-up')).status,200);assert.equal((await rate(5,'Resolved clearly')).status,200)
  const current=await get();assert.equal(current.rating.score,5);assert.equal(current.rating.scale,'five');assert.equal(current.rating.value,1);assert.equal(current.rating.revision,2)
  const results=await h.call('/api/outcomes/projects/p/results');assert.equal(results.summary.rated,1);assert.equal(results.summary.positive,1);assert.equal(results.results[0].response.channel,'widget');assert.equal(results.results[0].response.score,5)
  assert.equal((await h.raw(events,{...json({action:'optOutResolutionSurveys',data:{resolutionId:first.id}}),actor:'other'})).status,404)
  await h.db.prepare("UPDATE conversation_resolutions SET evidence_json=json_set(evidence_json,'$.widgetSurvey.expiresAt',1) WHERE id=?").bind(first.id).run()
  assert.equal((await rate(4)).status,409,'expired widgets refuse writes')
  await h.call(events,{...json({action:'optOutResolutionSurveys',data:{resolutionId:first.id}}),actor:'visitor'})
  assert.equal((await get()).survey.optedOut,true)
  await h.transition(c.id,{resolved:false});await h.send(c.id,'Follow-up',null,'visitor');await h.send(c.id,'New answer',{kind:'human'},'owner',true)
  const next=await get();assert.equal(next.survey.scale,'thumbs');assert.equal(next.survey.locale,'fr');assert.equal(next.survey.optedOut,true);assert.equal(next.rating,null)
  assert.equal((await h.raw(events,{...json({action:'rateResolution',data:{resolutionId:next.id,value:1}}),actor:'visitor'})).status,409,'opt-out persists across cycles')
  await configure({widgetEnabled:false});const other=await h.conversation('other');await h.send(other.id,'Answer',{kind:'human'},'owner',true)
  const disabled=(await h.call('/api/conversations/'+other.id+'/messages',{actor:'other'})).resolution
  assert.equal(disabled.survey.enabled,false)
  assert.equal((await h.raw('/api/conversations/'+other.id+'/widget-events',{...json({action:'rateResolution',data:{resolutionId:disabled.id,value:1}}),actor:'other'})).status,409)
  assert.equal(h.external,0)
 }finally{await h.close()}
}
