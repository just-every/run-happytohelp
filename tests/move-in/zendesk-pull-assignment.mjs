import assert from 'node:assert/strict'

// Agent 20 never authors a comment. Its unchanged identity must accompany each
// ticket batch, including catch-up when the incremental users page omits it.
export function assignmentSource(source){
 const people=[{id:20,name:'Mara Chen',email:'OWNER@example.test'},{id:21,name:'Remote teammate',email:'foreign@example.test'},{id:22,name:'Unreadable profile',email:'owner@example.test',user_fields:{legacy_profile:'x'.repeat(1024*1024)}}].map(person=>({...person,role:'agent',created_at:'2024-01-01T00:00:00Z',updated_at:'2024-01-04T00:00:00Z'}))
 const assignments={101:[20,'urgent'],102:[null,null],104:[21,'high'],105:[22,'low'],106:[20,'urgent'],107:[999,'normal']}
 return {...source,handler:async request=>{
  const response=await source.handler(request),url=new URL(request.url)
  if(!['/api/v2/incremental/users/cursor.json','/api/v2/users/show_many.json','/api/v2/incremental/tickets/cursor.json'].includes(url.pathname))return response
  const data=await response.json()
  if(data.users){
   const wanted=new Set((url.searchParams.get('ids')||'').split(','))
   data.users.push(...people.filter(person=>wanted.has(String(person.id))||person.id===20&&url.searchParams.get('start_time')==='0'))
  }
  if(data.tickets)data.tickets=data.tickets.map(ticket=>assignments[ticket.id]?{...ticket,assignee_id:assignments[ticket.id][0],priority:assignments[ticket.id][1]}:ticket)
  return Response.json(data,{status:response.status,headers:response.headers})
 }}
}

export async function assertPullAssignments(h,imported,ids=['101','102','104','105']){
 const expected={101:['owner','urgent'],102:[null,'normal'],104:[null,'high'],105:[null,'low'],106:['owner','urgent'],107:[null,'normal']}
 for(const sourceId of ids){
  const row=imported.find(row=>row.source_id===sourceId),base=`/api/dashboard/projects/p/conversations/${row.id}`
  const detail=(await h.call(base)).data,ticket=(await h.call(base+'/ticket')).data
  assert.deepEqual([detail.assigned_to,ticket.priority],expected[sourceId],`source ticket ${sourceId} keeps its exact native assignment and priority`)
 }
}

export async function assertPullAssignmentReview(h,pull,expected={101:false,102:false,104:true,105:false}){
 const omissions=new Map()
 for(const batch of pull.batches){
  const run=(await h.call(`/api/move-in/projects/p/imports/${batch.runId}`)).data
  for(const decision of run.plan.decisions)if(decision.kind==='ticket')omissions.set(decision.sourceId,decision.omissions.map(row=>row.reason))
 }
 if(omissions.has('105'))assert.ok(omissions.get('105').includes('historical_assignment_profile_refused:22:user_size_limit'),'the ticket points to its actual source-user refusal')
 for(const [id,unmatched] of Object.entries(expected))assert.equal(omissions.get(id).includes('historical_assignment_not_matched'),unmatched,`source ticket ${id} reports only genuine unmatched assignments`)
}
