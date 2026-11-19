import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
import {startApp} from '../../journeys/kit/app.mjs'
import {evidence} from '../../journeys/kit/browser.mjs'

export async function ticketReferenceSearch(){
 const app=await startApp(),shot=await evidence('ticket-reference-search')
 try{
  const w=await app.seedWorkspace('synthetic-happytohelp-reference'),other=await app.seedWorkspace('synthetic-happytohelp-reference-other')
  const group=(await app.ok(`/api/dashboard/projects/${w.projectId}/ticket-groups`,{token:w.tokens.owner,body:{name:'Private queue',members:[w.users.owner]}})).data
  const visible=['ca164bf0-0000-4000-8000-000000000001','ca164bf0-0000-4000-8000-000000000002'],hidden='ca164bf0-0000-4000-8000-000000000003',foreign='ca164bf0-0000-4000-8000-000000000004',decoy='aca164bf-0000-4000-8000-000000000005'
  // Deliberate UUID collision fixtures; creation and message admission otherwise
  // use the same public doors as normal inbox work. No production ID is renamed.
  for(const [id,workspace,groupId] of [...visible.map(id=>[id,w,null]),[hidden,w,group.id],[foreign,other,null],[decoy,w,null]]){
   const visitor=await app.ok('/api/identity/widget/session',{headers:{Origin:workspace.allowedOrigin},body:{widgetKey:workspace.widgetKey,name:'Synthetic customer',email:'synthetic-customer@example.test'}})
   await app.db.prepare('INSERT INTO conversations(id,project_id,contact_id,group_id,subject,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').bind(id,workspace.projectId,visitor.contactId,groupId,'Synthetic request',Date.now(),Date.now()).run()
   await app.ok(`/api/conversations/${id}/messages`,{token:visitor.token,body:{localId:'opening',content:[decoy,hidden,foreign].includes(id)?'Quoted reference CA164BF0 inside a message':'Please help with this request.',expectedRevision:0}})
  }
  const management=`/api/management/projects/${w.projectId}`
  const role=(await app.ok(`${management}/roles`,{token:w.tokens.owner,body:{name:'Ungrouped support',base:'operator',permissions:['conversations.manage','conversations.reply']}})).data
  await app.ok(`${management}/agents/${w.users.operator}`,{token:w.tokens.owner,method:'PUT',body:{role:role.id}})
  await app.db.prepare('UPDATE project_roles SET ticket_scope_json=? WHERE project_id=? AND id=?').bind(JSON.stringify({groupIds:[],includeUngrouped:true}),w.projectId,role.id).run()
  const results=[]
  for(const door of ['/api/dashboard/conversations',`/api/dashboard/projects/${w.projectId}/conversations`]){
   for(const reference of ['#CA164BF0','ca164bf0','#cA164bF0','CA164BF0']){
    const found=await app.ok(door+'?'+new URLSearchParams({search:reference}),{token:w.tokens.operator})
    const expected=reference.startsWith('#')?visible:[decoy,...visible].sort()
    assert.deepEqual(found.data.map(row=>row.id).sort(),expected,'show readable prefix matches and, for bare hex, text matches')
    assert.equal(found.meta.pagination.total,expected.length,'totals disclose only readable matches')
    if(!reference.startsWith('#'))assert.ok(found.data.find(row=>row.id===decoy).matched_message.content.includes('CA164BF0'))
    results.push({door,reference,ids:found.data.map(row=>row.id),total:found.meta.pagination.total})
   }
  }
  const owner=await app.ok('/api/dashboard/conversations?search=%23ca164bf0',{token:w.tokens.owner})
  assert.deepEqual(owner.data.map(row=>row.id).sort(),[...visible,hidden],'the owner can read the otherwise hidden match')
  assert.equal((await app.call(`/api/dashboard/projects/${w.projectId}/conversations/${hidden}`,{token:w.tokens.operator})).status,404)
  const dashboard=`/api/dashboard/projects/${w.projectId}`
  const snooze=(dependency_id,method='POST',path='')=>app.call(dashboard+'/workflow-schedules'+path,{
   token:w.tokens.operator,method,body:{conversation_id:decoy,kind:'snooze',owner_id:w.users.operator,timezone:'UTC',dependency_id}
  })
  const ambiguous=await snooze('#CA164BF0')
  assert.equal(ambiguous.status,400)
  assert.match(ambiguous.data.error,/more than one/i)
  const missing=await snooze('#00000000')
  assert.equal(missing.status,404)
  for(const unavailable of [hidden,foreign]){
   const denied=await snooze(unavailable)
   assert.equal(denied.status,missing.status);assert.deepEqual(denied.data,missing.data)
  }
  await app.ok(dashboard+`/conversations/${visible[1]}/ticket`,{token:w.tokens.owner,method:'PATCH',body:{group_id:group.id}})
  const accepted=await snooze(' #cA164bF0 ')
  assert.equal(accepted.status,201)
  assert.equal(accepted.data.data.dependency_id,visible[0],'only the readable match counts')
  const updated=await snooze(visible[0],'PATCH','/'+accepted.data.data.id)
  assert.equal(updated.status,200)
  assert.equal(updated.data.data.dependency_id,visible[0],'existing full IDs remain valid when editing')
  await writeFile(shot('receipt.json'),JSON.stringify({results,ownerMatches:owner.data.map(row=>row.id),tenantDenied:true,groupDenied:true,explicitReferenceExcludesText:true,bareReferenceIncludesText:true},null,2))
 }finally{await app.close()}
}
