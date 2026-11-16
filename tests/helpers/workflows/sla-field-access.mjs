import assert from 'node:assert/strict'
import {startApp} from '../../journeys/kit/app.mjs'

export async function slaFieldAccessJourney(){
 const app=await startApp()
 try{
  const w=await app.seedWorkspace('synthetic-happytohelp-sla'),p=w.projectId,base=`/api/dashboard/projects/${p}`,management=`/api/management/projects/${p}`,token=w.tokens.owner
  const door=async(path,body,method)=>(await app.ok(path,{token,...(body===undefined?{}:{body}),...(method?{method}:{})})).data
  const role=await door(management+'/roles',{name:'Stock reviewers',base:'operator',permissions:['conversations.notes']})
  const builtins=['owner','admin','operator','collaborator','api']
  const restricted=await door(base+'/ticket-fields',{name:'Order number',type:'text',read_roles:builtins})
  const readable=await door(base+'/ticket-fields',{name:'Public reference',type:'text',read_roles:[...builtins,role.id]})
  const unrestricted=await door(base+'/ticket-fields',{name:'Shared reference',type:'text',read_roles:[]})
  const calendar=await door(base+'/workflow-calendars',{name:'Stock support',timezone:'America/New_York',weekly:[1,2,3,4,5].map(day=>({day,start:'09:00',end:'17:00'})),holidays:'none',closures:[]})
  const policy={name:'Stock commitment',calendar_id:calendar.id,first_response_minutes:60,resolution_minutes:480}
  const condition=field=>({fields:{[field.id]:'SN-2'}})
  const create=conditions=>app.call(base+'/sla-policies',{token,body:{...policy,conditions}})
  const refused=await create(condition(restricted))
  assert.equal(refused.status,400,'a custom role without read access keeps the field out of SLA conditions')
  assert.match(refused.data.error,/customer-visible workspace fields/)
  assert.deepEqual(await door(base+'/sla-policies'),[],'refused creation leaves no policy')
  let saved=await door(base+'/sla-policies',{...policy,conditions:condition(readable)})
  assert.deepEqual(saved.conditions.fields,{[readable.id]:'SN-2'},'explicit access for every current role is accepted')
  const path=base+'/sla-policies/'+saved.id
  const denied=await app.call(path,{token,method:'PATCH',body:{conditions:condition(restricted)}})
  assert.equal(denied.status,400)
  assert.deepEqual((await door(base+'/sla-policies')).find(row=>row.id===saved.id),saved,'a refused edit preserves the saved policy')
  saved=await door(path,{conditions:condition(unrestricted)},'PATCH')
  assert.deepEqual(saved.conditions.fields,{[unrestricted.id]:'SN-2'},'an empty read-role list means everyone can read')
  await app.configure({})
  assert.deepEqual((await door(base+'/sla-policies')).find(row=>row.id===saved.id),saved,'accepted eligibility survives a runtime restart')
 }finally{await app.close()}
}
