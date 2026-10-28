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
 await imported(vendor,source,{check:async({h,review})=>{
  const company=(await h.call(native+'/companies')).companies[0];await h.call(native+'/companies/'+company.id,{...post({name:'Reviewed native company',revision:company.revision}),method:'PATCH'});
  await h.call(root+'/'+review.id+'/undo',post({}));await h.drain();assert.equal((await h.call(native+'/companies/'+company.id)).company.name,'Reviewed native company');assert.equal((await h.call(root+'/'+review.id)).data.error,'NATIVE_EDIT_CONFLICT');
 }});
 const changed=vendor==='intercom'?{contact:{companies:{data:[{id:'company-internal',type:'company'},{id:'other-company',type:'company'}],total_count:2,has_more:false}}}:vendor==='freshdesk'?{contact:{other_companies:[{company_id:72,view_all_tickets:true}]}}:null;
 if(changed)await imported(vendor,companySource(vendor,changed).map(JSON.stringify).join('\n'),{check:async({h,plan})=>{
  const company=(await h.call(native+'/companies')).companies[0];assert.equal(company.portalCompanyView,false);assert.equal(company.memberCount,vendor==='intercom'?0:1);assert.ok(plan.decisions.some(row=>row.omissions.some(item=>item.reason===(vendor==='intercom'?'multiple_company_memberships_require_native_review':'additional_company_memberships_not_imported'))));
 }});
 if(vendor!=='intercom')await imported(vendor,source,{before:async h=>{await h.call(native+'/companies',post({name:'Existing account',domains:['northstar.example']}));return h.snapshot()},check:async({h,plan})=>{assert.ok(plan.decisions.some(row=>row.rejection==='company_domain_conflict'));assert.equal((await h.call(native+'/companies')).companies.length,1,'a shared domain never merges unrelated accounts')}});
}
