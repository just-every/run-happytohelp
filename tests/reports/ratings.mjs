import assert from 'node:assert/strict';
import {harness,json} from './harness.mjs';
import {proveProvenance} from './outcomes.mjs';
export async function ratingsJourney(){const h=await harness();try{


 await h.contact();await h.contact('other');await h.contact('outsider','q');await proveProvenance(h);const c=await h.conversation();await h.send(c.id,'Question',null,'visitor');await h.send(c.id,'Answer',{kind:'human'},'owner',true);
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
 const operator=(await h.call('/api/dashboard/projects/p/conversations/'+c.id)).data;
 assert.equal(operator.resolution.rating.comment,'Solved');
 assert.equal(operator.resolutionHistory.find(r=>r.id===resolution.id).rating.comment,'Please clarify');
 assert.equal((await h.raw('/api/dashboard/projects/p/conversations/'+c.id,{actor:'visitor'})).status,403);
 assert.equal((await h.raw('/api/dashboard/projects/p/conversations/'+c.id,{actor:'foreign'})).status,404);
 // The same erasure covers both retained and reassigned conversations; the new contact survives unchanged.
 await h.contact('new-contact');const transferred=await h.conversation();await h.send(transferred.id,'Answer',{kind:'human'},'owner',true);
 const transferredResolution=(await h.call('/api/conversations/'+transferred.id+'/messages',{actor:'visitor'})).resolution;
 await h.call('/api/conversations/'+transferred.id+'/widget-events',{...json({action:'rateResolution',data:{resolutionId:transferredResolution.id,value:1,comment:'Original visitor private text'}}),actor:'visitor'});
 await h.db.prepare("UPDATE conversations SET contact_id='new-contact' WHERE id=?").bind(transferred.id).run();
 await h.call('/api/management/projects/p/contacts/visitor/erase',json({}));assert.equal((await h.db.prepare("SELECT COUNT(*) n FROM conversation_ratings WHERE comment<>''").first()).n,0);assert.equal((await h.db.prepare("SELECT COUNT(*) n FROM conversation_rating_history WHERE comment<>''").first()).n,0);assert.equal((await rate({resolutionId:next.id,value:1})).status,401);for(const table of ['conversation_ratings','conversation_rating_history'])assert.equal((await h.db.prepare('SELECT comment FROM '+table+' WHERE resolution_id=?').bind(transferredResolution.id).first()).comment,'');assert.equal((await h.db.prepare("SELECT metadata_json FROM contacts WHERE id='new-contact'").first()).metadata_json,'{}');assert.equal(h.external,0)

}finally{await h.close()}}
