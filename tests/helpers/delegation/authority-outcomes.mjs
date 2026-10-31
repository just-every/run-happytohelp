import assert from 'node:assert/strict'
import {computersApp,completed} from './computers.mjs'
import {customerFixture} from '../delegation-journey/fixture.mjs'
import {connectorAuthorityOutcomes} from './authority-connector.mjs'

// These are device/operator HTTP commands, not calls to implementation helpers.
// No model or customer operation runs for the protocol-only cases.
export async function authorityOutcomes(){
 const t=await computersApp({operators:['u','peer'],conversations:['modes','stale','approved']})
 const fixture=await customerFixture()
 const {request,delegate,claimed,report,app}=t
 const base=c=>`/api/projects/p/conversations/${c}/delegations`
 const count=async c=>({jobs:(await app.first('SELECT COUNT(*) n FROM local_jobs WHERE conversation_id=?',c)).n,messages:(await app.first('SELECT COUNT(*) n FROM messages WHERE conversation_id=?',c)).n,events:fixture.events.length})
 const ticket=async()=>(await request('/api/conversations/modes'))
 const note=async(c,id,summary)=>{
  const bucket=await request(`/api/dashboard/projects/p/conversations/${c}/buckets/${c}`)
  assert.equal(bucket.status,200)
  const notes=bucket.data.events.filter(e=>e.type==='INTERNAL_NOTE'&&e.id==='delegation:'+id)
  assert.equal(notes.length,1);assert.equal(notes[0].agent_id,'u');assert.match(notes[0].content,new RegExp(summary))
 }
 try{
  const device=await t.pair()
  assert.deepEqual(await count('modes'),{jobs:0,messages:0,events:0})
  // Resolve is an operational grant, never a grant to send or close the ticket.
  const resolve=await delegate('modes',device.id,'resolve','operator','resolve')
  const rc=await claimed(device,'resolve',resolve),resolved={...completed('Verified resolve'),reply_draft:'Legacy text must remain unsent'}
  assert.equal((await report(resolve,rc,'resolve',resolved,device.token)).status,200)
  assert.equal((await report(resolve,rc,'resolve',resolved,device.token)).status,200)
  assert.equal((await ticket()).resolved_at,null)
  assert.deepEqual(await count('modes'),{jobs:1,messages:0,events:0});await note('modes',resolve,resolved.summary)

  // A replies key (including an empty array) disables legacy automatic delivery.
  for(const replies of [[],[{id:'selected',title:'Selected',body:'Explicitly selected reply'},{id:'other',title:'Other',body:'Unselected reply'}]]){
   const before=await count('modes'),id=await delegate('modes',device.id,'selection-'+before.jobs,'operator','resolve_reply')
   const claim=await claimed(device,'selection-'+before.jobs,id)
   const result={...completed('Verified reply proposals'),reply_draft:'Never send legacy fallback',replies}
   assert.equal((await report(id,claim,'selection',result,device.token)).status,200)
   assert.equal((await report(id,claim,'selection',result,device.token)).status,200)
   assert.deepEqual(await count('modes'),{...before,jobs:before.jobs+1});assert.equal((await ticket()).resolved_at,null)
   if(replies.length){
    const send=base('modes')+`/${id}/result/replies/selected/send`
    assert.equal((await request(send,{},'missing-session')).status,401)
    assert.equal((await request(send,{},'operator2')).status,404,'another member cannot approve this operator’s result')
    const sent=await request(send,{});assert.equal(sent.status,200);assert.equal(sent.data.status,'sent')
    assert.equal((await request(send,{})).data.message_id,sent.data.message_id)
    const transcript=await request('/api/conversations/modes/messages')
    assert.deepEqual(transcript.messages.map(m=>m.content),['Explicitly selected reply'])
    assert.equal((await ticket()).resolved_at,null,'selected reply does not implicitly close the conversation')
    assert.deepEqual(await count('modes'),{jobs:before.jobs+1,messages:before.messages+1,events:0})
   }
   await note('modes',id,result.summary)
  }
  const before=await count('modes'),unverified=await delegate('modes',device.id,'unverified-reply','operator','resolve_reply')
  const uc=await claimed(device,'unverified-reply',unverified),unsafe={summary:'Unverified reply',actions:[],verified:false,reply_draft:'Unsafe legacy',replies:[{id:'unsafe',title:'Unsafe',body:'Unsafe proposal'}]}
  const pending=await report(unverified,uc,'unverified',unsafe,device.token)
  assert.equal(pending.status,200);assert.equal(pending.data.status,'needs_input')
  assert.equal((await request(base('modes')+`/${unverified}/result/replies/unsafe/send`,{})).status,409)
  assert.deepEqual(await count('modes'),{...before,jobs:before.jobs+1});assert.equal((await ticket()).resolved_at,null)
  assert.equal((await request(base('modes')+`/${unverified}/cancel`,{})).status,200)
  assert.equal((await report(unverified,uc,'cancelled',unsafe,device.token,'cancelled')).status,200)

  // The legacy protocol still honors an advance resolve-and-reply grant exactly once.
  const legacyBefore=await count('modes'),legacy=await delegate('modes',device.id,'legacy','operator','resolve_reply')
  const lc=await claimed(device,'legacy',legacy),legacyResult={...completed('Verified legacy reply'),reply_draft:'Advance authorized reply'}
  assert.equal((await report(legacy,lc,'legacy',legacyResult,device.token)).status,200)
  assert.equal((await report(legacy,lc,'legacy',legacyResult,device.token)).status,200)
  assert.ok((await ticket()).resolved_at)
  assert.deepEqual(await count('modes'),{jobs:legacyBefore.jobs+1,messages:legacyBefore.messages+1,events:0})
  const security=await request('/api/management/projects/p/audit');assert.equal(security.status,200)
  const audit=security.data.filter(a=>a.action==='delegation.reply_sent')
  assert.deepEqual(audit.map(a=>a.actor_id),['u','u']);await note('modes',legacy,legacyResult.summary)

  const proposal={...completed('Read-only proposal'),follow_up_actions:[{id:'fix',title:'Fix',mode:'resolve',instructions:'Apply only the reviewed fixture repair'}]}
  for(const c of ['stale','approved']){
   assert.deepEqual(await count(c),{jobs:0,messages:0,events:0})
   const parent=await delegate(c,device.id,c),claim=await claimed(device,c,parent)
   assert.equal((await report(parent,claim,c,proposal,device.token)).status,200)
   const approve=base(c)+`/${parent}/result/follow-up-actions/fix`
   assert.deepEqual(await count(c),{jobs:1,messages:0,events:0})
   if(c==='stale'){
    const changed=await request(`/api/conversations/${c}/messages`,{localId:'new-frontier',content:'New information after investigation',expectedRevision:0,expectedLastMessageId:null})
    assert.equal(changed.status,200);assert.equal(changed.accepted,true)
    assert.equal((await request(approve,{})).status,409,'a stale proposal cannot authorize a new fix')
    assert.deepEqual(await count(c),{jobs:1,messages:1,events:0})
   }else{
    assert.equal((await request(approve,{},'missing-session')).status,401)
    assert.equal((await request(approve,{},'operator2')).status,404)
    const approvals=await Promise.all([request(approve,{}),request(approve,{})])
    for(const a of approvals)assert.equal(a.status,200,JSON.stringify(a))
    const child=approvals[0].data.child_delegation_id
    assert.equal(approvals[1].data.child_delegation_id,child,'concurrent approvals cannot create two children')
    assert.equal((await request(approve,{})).data.child_delegation_id,child)
    const childClaim=await claimed(device,'approved-child',child)
    assert.equal((await report(child,childClaim,'child',completed('Approved child result'),device.token)).status,200)
    assert.equal((await request(approve,{})).data.child_delegation_id,child,'an already approved proposal never launches another fix')
    assert.deepEqual(await count(c),{jobs:2,messages:0,events:0})
    await note(c,child,'Approved child result')
   }
   await note(c,parent,proposal.summary)
  }
  assert.equal(fixture.enabled,false);assert.deepEqual(app.requests,[],'the Worker never executes local customer operations')
 }finally{await fixture.close();await t.close()}
 await connectorAuthorityOutcomes()
}
