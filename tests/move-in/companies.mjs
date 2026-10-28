import assert from 'node:assert/strict';
import {assertBusinessEquality} from './business-equality.mjs';
import {customer} from './helpscout-fixtures.mjs';
const root='/api/move-in/projects/p/imports',native='/api/management/projects/p',post=body=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const dates={created_at:'2024-01-01T00:00:00Z',updated_at:'2024-01-02T00:00:00Z'};
export function companySource(vendor,extra={}){
 const company={id:71,name:'Northstar Bikes',domains:['northstar.example'],...dates,...extra.company};
 if(vendor==='zendesk')return [{organization:{...company,domain_names:company.domains,shared_tickets:true,shared_comments:true,domains:undefined}},{user:{id:1,name:'Mara Chen',email:'mara@northstar.example',role:'end-user',created_at:dates.created_at,organization_id:71,...extra.contact}}];
 if(vendor==='freshdesk')return [{company},{contact:{id:1,name:'Mara Chen',email:'mara@northstar.example',active:true,created_at:dates.created_at,company_id:71,...extra.contact}}];
 if(vendor==='helpscout')return [{organization:{id:71,name:company.name,domains:company.domains,...extra.company}},{...customer(1,'mara@northstar.example'),organizationId:71,...extra.contact}];
 return [{type:'company',id:'company-internal',company_id:'external-account',name:company.name,website:'https://northstar.example',created_at:1704067200,updated_at:1704153600,...extra.company},{type:'contact',id:'contact-internal',name:'Mara Chen',email:'mara@northstar.example',created_at:1704067200,companies:{data:[{id:'company-internal',type:'company',url:'/companies/company-internal'}],total_count:1,has_more:false},...extra.contact}];
}

// Folded into each existing vendor history phase, including its native reads,
// source-preserving repeat, guarded whole undo and later native ownership.
export async function companyJourney(imported,vendor){
 const source=companySource(vendor).map(JSON.stringify).join('\n');
 await imported(vendor,source,{before:h=>h.snapshot(),check:async({h,initial,review,plan})=>{
  assert.equal(plan.counts.rejected,0,JSON.stringify(plan.decisions));
  const companies=await h.call(native+'/companies');assert.equal(companies.companies.length,1);const company=companies.companies[0];assert.equal(company.name,'Northstar Bikes');assert.equal(company.portalCompanyView,false);assert.equal(company.memberCount,1);
  assert.deepEqual(company.domains,vendor==='intercom'?[]:['northstar.example']);
  const detail=await h.call(native+'/companies/'+company.id);assert.equal(detail.members.length,1);assert.equal(detail.members[0].email,'mara@northstar.example');
  const before=await h.snapshot(),uploaded=(await h.call(root+'?vendor='+vendor,{method:'POST',headers:{'X-Import-Filename':'companies-repeat.jsonl','X-Import-Schema':'2.16'},body:'\n'+source})).data;await h.drain();const repeat=(await h.call(root+'/'+uploaded.id)).data;assert.equal(repeat.plan.counts.rejected,0,JSON.stringify(repeat.plan.decisions));await h.call(root+'/'+repeat.id+'/apply',post({fingerprint:repeat.plan.fingerprint}));await h.drain();assertBusinessEquality(before,await h.snapshot());
  await h.call(root+'/'+review.id+'/undo',post({}));await h.drain();assertBusinessEquality(initial,await h.snapshot());
 }});
}
