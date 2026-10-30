import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {accessToken,autonomousPolicy} from '../../../src/vendor/agent-base/modules/agent-door/conformance/crypto.mjs'
import {archivePolicy} from '../../../scripts/installer/portability-policy.mjs'

// Functional native operator qualification. This is separate from the fixed
// adoption conformance phases and adds no test registrations.
export async function supportToolsJourney({app,native,call,rpc,adopt,context,owner,settings,existingMemberSub,existingMemberEmail,person,reviewerSub,reviewerEmail}){
 const P=`/api/management/projects/${owner.projectId}`,D=`/api/dashboard/projects/${owner.projectId}`
 const memberEmail='synthetic-draft-person@example.test',memberSub=randomUUID()
 const invite=(await native(P+'/agents',{body:{email:memberEmail}})).data
 await app.ok('/api/identity/accept-token',{body:{token:new URL(invite.invitationUrl).searchParams.get('token'),name:'Synthetic Draft Teammate',password:'synthetic-happytohelp-draft-password'}})
 const member=await app.ok('/api/identity/login',{body:{email:memberEmail,password:'synthetic-happytohelp-draft-password'}})
 assert.equal((await settings(3,[{id:existingMemberSub,email:existingMemberEmail,name:'Jordan Support',role:'member',invite:1},{id:reviewerSub,email:reviewerEmail,name:'Riley Quality',role:'member',invite:1},{id:memberSub,email:memberEmail,name:'Synthetic Draft Teammate',role:'member',invite:1}])).status,200)
 const shared=(await native(P+'/macros',{body:{title:'Synthetic shipping reply',content:'Your synthetic order ships in two days.'}})).data
 const personal=(await app.ok(P+'/macros',{token:member.token,body:{title:'Synthetic private reply',content:'Only my own reply.',scope:{visibility:'personal'}}})).data
 const restricted=(await native(P+'/macros',{body:{title:'Synthetic agent reply',content:'Only the native agent role.',scope:{roles:['operator']}}})).data
 const group=(await native(P+'/ticket-groups',{body:{name:'Synthetic dispatch',members:[member.actor.id]}})).data
 const grouped=(await native(P+'/macros',{body:{title:'Synthetic dispatch reply',content:'Dispatch details.',scope:{visibility:'group',groups:[group.id]}}})).data
 const memberCredential=()=>accessToken(context,{sub:memberSub,email:memberEmail,act:{sub:'synthetic-happytohelp-draft-agent',name:'Synthetic support helper',specialist:'support agent'}})
 const memberCall=async(name,args)=>call(name,args,await memberCredential())
 const tools=(await rpc('tools/list')).data.result.tools
 const newNames=['happytohelp.saved_replies.list','happytohelp.saved_replies.read','happytohelp.settings.read','happytohelp.drafts.read','happytohelp.conversations.draft']
 for(const name of newNames){const tool=tools.find(t=>t.name===name);assert.ok(tool,name);assert.equal(tool.annotations.readOnlyHint,name!=='happytohelp.conversations.draft');console.log('ADVERTISED '+JSON.stringify({name,scope:tool._meta['com.runeditrun/scope'],readOnly:tool.annotations.readOnlyHint,classes:tool._meta['com.runeditrun/classes']}))}
 const list=await call(newNames[0],{q:'synthetic',limit:1})
 assert.equal(list.outcome,'done',JSON.stringify(list));assert.equal(list.result.data.length,1);assert.equal(list.result.pagination.hasMore,true)
 const all=await call(newNames[0],{q:'synthetic'})
 const nativeList=await native(P+'/macros?search=synthetic')
 assert.deepEqual(all.result.data.map(r=>r.id),nativeList.data.map(r=>r.id))
 assert.ok(!all.result.data.some(r=>[personal.id,restricted.id,grouped.id].includes(r.id)))
 for(const row of [personal,restricted,grouped])assert.equal((await call(newNames[1],{id:row.id})).code,'not_found')
 for(const row of [shared,personal,restricted,grouped])assert.equal((await memberCall(newNames[1],{id:row.id})).result.reply.content,row.content)
 assert.equal((await call(newNames[1],{id:shared.id})).result.reply.content,shared.content)
 console.log('PROBE S1: /mcp saved_replies.list/read q=synthetic, personal/role/group ids -> native search/detail equality; hidden replies refused')
 await native(P+'/settings',{method:'PUT',body:{timezone:'America/New_York',language:'en',is_available:false,unavailable_message:'Synthetic desk closed'}})
 // Synthetic unknown connection fields, including nested settings, must never be
 // swept into a future projection just because their names look innocuous.
 await app.db.prepare("UPDATE project_settings SET settings_json=json_set(settings_json,'$.connection',json('{\"credential\":\"synthetic-happytohelp-hidden\"}'),'$.availability_schedule',json('{\"days\":[1,2],\"time_from\":\"09:00\",\"time_to\":\"17:00\",\"password\":\"synthetic-happytohelp-hidden\"}')) WHERE project_id=?").bind(owner.projectId).run()
 const settings=await call(newNames[2],{project_id:owner.projectId})
 assert.equal(settings.outcome,'done',JSON.stringify(settings));assert.equal(settings.result.settings.timezone,'America/New_York');assert.equal(settings.result.settings.is_available,false)
 assert.ok(!JSON.stringify(settings).includes('synthetic-happytohelp-hidden'));assert.ok(!('settings_json' in settings.result.settings));assert.ok(!('widget_key' in settings.result.settings))
 assert.equal((await memberCall(newNames[2],{project_id:owner.projectId})).result.settings.timezone,'America/New_York','native Settings GET is available to a current staff member')
 const other=await app.seedWorkspace('synthetic-happytohelp-foreign')
 const foreignMacro=(await app.ok(`/api/management/projects/${other.projectId}/macros`,{token:other.tokens.owner,body:{title:'Foreign reply',content:'Foreign tenant content'}})).data
 for(const [name,args] of [[newNames[1],{id:foreignMacro.id}],[newNames[2],{project_id:other.projectId}]])assert.equal((await call(name,args)).code,'not_found')
 assert.equal((await rpc('tools/list',{},await accessToken(context,{sub:randomUUID(),email:'unknown@example.test'}))).status,401)
 assert.equal((await rpc('tools/list',{},await accessToken(context,{business:'foreign-business'}))).status,401)
 console.log('PROBE S2: /mcp settings.read linked/foreign project -> native timezone/availability; no raw JSON, nested credentials or cross-project data; unknown sponsor denied')
 const create=async(label)=>{const contact=(await native(P+'/contacts',{body:{name:'Synthetic '+label,email:'synthetic-'+label+'@example.test'}})).data;const ticket=await native('/api/conversations',{body:{projectId:owner.projectId,contactId:contact.id}});return {contact,ticket}}
 const erased=await create('erase-draft'),retained=await create('retain-draft'),C=id=>D+'/conversations/'+id
 const args=(ticket,content,draft_id=null)=>({id:ticket.id,content,draft_id,revision:ticket.revision,last_message_id:ticket.last_message_id,idempotency_key:randomUUID()})
 const firstArgs=args(erased.ticket,'Synthetic personal draft for erase-draft')
 await app.takeJobs();const networkAt=app.requests.length
 const messagesBefore=await app.sql('SELECT id,content,revision FROM messages ORDER BY id')
 const created=await call(newNames[4],firstArgs)
 assert.equal(created.outcome,'done',JSON.stringify(created))
 const draft=(await call(newNames[3],{id:erased.ticket.id})).result.draft
 assert.equal(draft.content,firstArgs.content);assert.equal(draft.usage_id,created.result.draft.id)
 assert.equal((await native(C(erased.ticket.id)+'/macro-draft')).data.content,firstArgs.content)
 assert.equal((await memberCall(newNames[3],{id:erased.ticket.id})).result.draft,null,'another operator has an independent slot')
 const memberArgs=args(erased.ticket,'Another operator own draft')
 assert.equal((await memberCall(newNames[4],memberArgs)).outcome,'done')
 assert.equal((await native(C(erased.ticket.id)+'/macro-draft')).data.content,firstArgs.content)
 assert.equal((await call(newNames[4],args(erased.ticket,'Stale null replacement'))).code,'revision_conflict')
 assert.equal((await call(newNames[4],{...firstArgs,content:'Different retry'})).code,'idempotency_conflict')
 const edited=await call(newNames[4],args(erased.ticket,'Synthetic updated personal draft',draft.usage_id));assert.equal(edited.outcome,'done')
 assert.equal((await call(newNames[4],args(erased.ticket,'Stale prior version',draft.usage_id))).code,'revision_conflict')
 const retry=await call(newNames[4],firstArgs);assert.equal(retry.result.draft.id,created.result.draft.id)
 assert.equal((await native(C(erased.ticket.id)+'/macro-draft')).data.content,'Synthetic updated personal draft','an old replay never rolls back a later edit')
 const stored=await app.first('SELECT * FROM macro_drafts WHERE project_id=? AND conversation_id=? AND actor_id=?',owner.projectId,erased.ticket.id,owner.userId)
 assert.deepEqual(archivePolicy.exportRow('macro_drafts',stored),stored,'the native portable draft row retains content and ownership')
 await app.configure({})
 assert.equal((await call(newNames[4],firstArgs)).result.draft.id,created.result.draft.id)
 assert.equal((await call(newNames[3],{id:erased.ticket.id})).result.draft.content,'Synthetic updated personal draft')
 // One real conversation-revision change rejects a stale preparation too.
 const stale=args(erased.ticket,'Prepared on a stale transcript',edited.result.draft.id)
 await app.db.prepare('UPDATE conversations SET revision=revision+1 WHERE id=?').bind(erased.ticket.id).run()
 assert.equal((await call(newNames[4],stale)).code,'revision_conflict')
 await app.db.prepare('UPDATE conversations SET revision=revision-1 WHERE id=?').bind(erased.ticket.id).run()
 assert.deepEqual(await app.sql('SELECT id,content,revision FROM messages ORDER BY id'),messagesBefore)
 assert.deepEqual(await app.takeJobs(),[]);assert.equal(app.requests.length,networkAt)
 console.log('PROBE S3: /mcp conversations.draft + drafts.read and native macro-draft -> persistent own slot; replay/restart stable; stale version/transcript refused; messages/network/jobs unchanged')
 // Policy blocks and approval hold precede persistence; approving internal work
 // creates a draft only. The new allowlist contains no send or publication scope.
 const retainedArgs=args(retained.ticket,'Synthetic retained draft')
 await adopt({...autonomousPolicy(),rules:[{id:'stop',class:'*',do:'blocked'}]})
 assert.equal((await call(newNames[4],retainedArgs)).code,'policy_blocked');assert.equal((await native(C(retained.ticket.id)+'/macro-draft')).data,null)
 await adopt({...autonomousPolicy(),rules:[{id:'hold',class:'*',do:'approval',approver:['person:'+reviewerSub],wait:'PT1H'}]})
 const held=await rpc('tools/call',{name:newNames[4],arguments:retainedArgs}),approval=held.data.result._meta['com.runeditrun/approval']
 assert.ok(approval.id);assert.equal((await native(C(retained.ticket.id)+'/macro-draft')).data,null)
 const view=(await person('/agents/api/approvals/'+approval.id)).data.approval
 assert.equal((await person('/agents/api/approvals/'+approval.id+'/approve',{revision:view.revision,summary_sha256:view.summary_sha256})).data.approval.state,'executed')
 assert.equal((await native(C(retained.ticket.id)+'/macro-draft')).data.content,retainedArgs.content)
 await adopt()
 assert.deepEqual(await app.takeJobs(),[]);assert.equal(app.requests.length,networkAt)
 // Public-door customer erasure fences replay as well as fresh reads.
 const pendingArgs=args(erased.ticket,'Synthetic pending erased customer',edited.result.draft.id)
 await adopt({...autonomousPolicy(),rules:[{id:'hold',class:'*',do:'approval',approver:['person:'+reviewerSub],wait:'PT1H'}]})
 const pending=await rpc('tools/call',{name:newNames[4],arguments:pendingArgs}),pendingId=pending.data.result._meta['com.runeditrun/approval'].id
 await adopt()
 assert.equal((await native(P+'/contacts/'+erased.contact.id+'/erase',{body:{}})).data?.erased??true,true)
 await app.configure({})
 assert.equal((await call(newNames[3],{id:erased.ticket.id})).code,'not_found')
 assert.equal((await call(newNames[4],firstArgs)).code,'not_found')
 assert.equal((await app.first('SELECT count(*) n FROM macro_drafts WHERE conversation_id=?',erased.ticket.id)).n,0)
 assert.equal(await app.first('SELECT id FROM agent_door_approvals WHERE id=?',pendingId),null)
 assert.equal((await call(newNames[3],{id:retained.ticket.id})).result.draft.content,retainedArgs.content)
 // Native role narrowing applies on the next request, including a cached replay.
 const role=(await native(P+'/roles',{body:{name:'Synthetic draft reader only',base:'operator',permissions:[]}})).data
 await native(P+'/agents/'+member.actor.id,{method:'PUT',body:{role:role.id}})
 assert.equal((await memberCall(newNames[4],args(retained.ticket,'Forbidden role'))).code,'not_found')
 assert.equal((await memberCall(newNames[3],{id:retained.ticket.id})).code,'not_found')
 await native(P+'/agents/'+member.actor.id,{method:'PUT',body:{role:'operator'}})
 const memberRetained=args(retained.ticket,'Synthetic teammate personal reply')
 assert.equal((await memberCall(newNames[4],memberRetained)).outcome,'done')
 const memberOp=await app.first("SELECT id FROM h2h_agent_operations WHERE tool=? AND sponsor_id=? ORDER BY at DESC LIMIT 1",newNames[4],member.actor.id)
 const machineCount=(await app.first('SELECT count(*) n FROM h2h_agent_operations')).n
 await native(P+'/agents/'+member.actor.id+'/erase',{body:{}})
 await app.configure({})
 assert.equal((await app.first('SELECT count(*) n FROM macro_drafts WHERE actor_id=?',member.actor.id)).n,0)
 assert.equal((await rpc('tools/list',{},await memberCredential())).status,401)
 const op=(await app.first('SELECT sponsor_name FROM h2h_agent_operations WHERE id=?',memberOp.id));assert.equal(op.sponsor_name,'Former teammate')
 assert.equal((await app.first('SELECT count(*) n FROM h2h_agent_operations')).n,machineCount)
 assert.equal((await native(C(retained.ticket.id)+'/macro-draft')).data.content,retainedArgs.content)
 assert.deepEqual(archivePolicy.exportRow('macro_drafts',await app.first('SELECT * FROM macro_drafts WHERE conversation_id=? AND actor_id=?',retained.ticket.id,owner.userId)).content,retainedArgs.content)
 console.log('PROBE S4: /mcp blocked/held/approved draft, native customer/member erasure, restart -> no mutation before approval; erased drafts/pending display unavailable; native attribution anonymized; unrelated draft and machine history retained')
 // The draft-only public flow uses the real scopes, with no scope widening.
 const allowlist=['happytohelp.conversations.read','happytohelp.saved_replies.list','happytohelp.saved_replies.read','happytohelp.settings.read','happytohelp.conversations.draft','happytohelp.drafts.read']
 const credential=await accessToken(context,{scope:allowlist.join(' ')})
 const flow=(name,args)=>call(name,args,credential)
 const ticket=(await flow(allowlist[0],{id:retained.ticket.id})).result.ticket
 const selected=(await flow(allowlist[1],{q:'shipping'})).result.data[0]
 const reply=(await flow(allowlist[2],{id:selected.id})).result.reply
 assert.equal((await flow(allowlist[3],{project_id:owner.projectId})).result.settings.timezone,'America/New_York')
 const current=(await flow(allowlist[5],{id:ticket.id})).result.draft
 assert.equal((await flow(allowlist[4],args(ticket,reply.content,current.usage_id))).outcome,'done')
 assert.equal((await flow(allowlist[5],{id:ticket.id})).result.draft.content,reply.content)
 assert.deepEqual(await app.takeJobs(),[]);assert.equal(app.requests.length,networkAt)
 assert.deepEqual(await app.sql('SELECT id,content,revision FROM messages ORDER BY id'),messagesBefore)
 for(const name of ['happytohelp.conversations.note','happytohelp.conversations.send']){const denied=await rpc('tools/call',{name,arguments:{id:ticket.id,content:'Must not send',idempotency_key:randomUUID()}},credential);assert.ok(denied.status===403||denied.data.result?.isError)}
 console.log('PROBE S5: scoped /mcp case -> saved reply -> Settings -> conversations.draft -> drafts.read -> real persisted reply, zero provider calls/jobs/messages; allowlist='+allowlist.join(','))
}
