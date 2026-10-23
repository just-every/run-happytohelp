import assert from 'node:assert/strict'
import {nativeHarness} from './harness.mjs'
import {zip} from './zip.mjs'
import {assertBusinessEquality} from './business-equality.mjs'

export async function companyJourney(){
 const dates={created_at:'2024-01-01T00:00:00Z',updated_at:'2024-01-02T00:00:00Z'},scoutDates={createdAt:dates.created_at,updatedAt:dates.updated_at}
 const fixtures=[
  ['zendesk',[{organization:{id:30,name:'Ridgeline Supply',domain_names:['ridgeline.example'],shared_tickets:true,shared_comments:true,...dates}},{user:{id:10,name:'Mara',email:'mara@example.test',role:'end-user',organization_id:30,created_at:dates.created_at}},{group:{id:40,name:'Returns',...dates}}]],
  ['freshdesk',[{company:{id:30,name:'Ridgeline Supply',domains:['ridgeline.example'],custom_fields:{plan:'enterprise'},...dates}},{contact:{id:10,name:'Mara',email:'mara@example.test',company_id:30,view_all_tickets:true,...dates}},{group:{id:40,name:'Returns',agent_ids:[50],...dates}}]],
  ['intercom',[{type:'company',id:'source-company',company_id:'external-company',name:'Ridgeline Supply',created_at:1704067200,updated_at:1704153600},{type:'contact',id:'10',name:'Mara',email:'mara@example.test',created_at:1704067200,companies:{data:[{id:'source-company',type:'company'}],has_more:false,total_count:1}},{type:'team',id:'40',name:'Returns',admin_ids:[50],distribution_method:'round_robin'}]],
  ['helpscout',[{organizations:[{id:30,name:'Ridgeline Supply',domains:['ridgeline.example'],properties:[]}]},{customers:[{id:10,firstName:'Mara',organizationId:30,_embedded:{emails:[{value:'mara@example.test',type:'work'}]},createdAt:dates.created_at}]},{teams:[{id:40,name:'Returns',...scoutDates}]}]]
 ]
 for(const [vendor,records] of fixtures){
  const h=await nativeHarness(),root='/api/move-in/projects/p/imports',post=body=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
  try{
   const initial=await h.snapshot(),source=records.map(JSON.stringify).join('\n')
   const apply=async body=>{const upload=(await h.call(root+'?vendor='+vendor,{method:'POST',body,headers:{'X-Import-Filename':'company.zip','X-Import-Schema':'2.16'}})).data;await h.drain();const run=(await h.call(root+'/'+upload.id)).data;assert.equal(run.state,'ready');assert.equal(run.plan.counts.rejected,0,JSON.stringify(run));await h.call(root+'/'+run.id+'/apply',post({fingerprint:run.plan.fingerprint}));await h.drain();assert.equal((await h.call(root+'/'+run.id)).data.state,'completed');return run}
   const run=await apply(zip([{name:'records.jsonl',body:source}]))
   const companies=await h.call('/api/dashboard/projects/p/companies');assert.equal(companies.companies.length,1)
   const company=companies.companies[0],detail=await h.call('/api/dashboard/projects/p/companies/'+company.id)
   assert.equal(company.name,'Ridgeline Supply');assert.equal(detail.members.length,1);assert.equal(detail.members[0].email,'mara@example.test')
   assert.equal(company.portalCompanyView,false,'historical sharing never grants native portal visibility');assert.deepEqual(company.domains,[],'source domains never infer affiliation')
   assert.equal((await h.call('/api/dashboard/projects/p/ticket-groups')).data.find(group=>group.name==='Returns').members.length,0,'historical staff gain no native membership')
   assert.equal((await h.db.prepare('SELECT count(*) n FROM users').first()).n,3)
   const beforeRepeat=await h.snapshot(),repeat=await apply(zip([{name:'repacked.jsonl',body:source+'\n'}]))
   assertBusinessEquality(beforeRepeat,await h.snapshot())
   for(const id of [repeat.id,run.id]){await h.call(root+'/'+id+'/undo',post({}));await h.drain();assert.equal((await h.call(root+'/'+id)).data.state,'undone')}
   assertBusinessEquality(initial,await h.snapshot());assert.equal(h.outbound,0)
  }finally{await h.close()}
 }
}
