import assert from 'node:assert/strict';
import {assertBusinessEquality} from './business-equality.mjs';
const post=body=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const root='/api/move-in/projects/p/imports',dashboard='/api/dashboard/projects/p';

export async function configurationFieldsJourney(imported){
 const dates={created_at:'2024-01-01T00:00:00Z',updated_at:'2024-01-02T00:00:00Z'};
 const field=(id,type,title,extra={})=>({ticket_field:{id,type,title,title_in_portal:title,description:'From the previous help desk',active:true,required:false,visible_in_portal:true,editable_in_portal:true,required_in_portal:true,agent_can_edit:true,...dates,...extra}});
 const form=(id,name,ids,extra={})=>({ticket_form:{id,name,display_name:name,active:true,default:false,end_user_visible:true,in_all_brands:true,restricted_brand_ids:[],ticket_field_ids:ids,agent_conditions:[],end_user_conditions:[],...dates,...extra}});
 const fields=[field(301,'text','Order number',{required:true}),field(302,'integer','Items'),field(303,'checkbox','Replacement requested'),field(304,'tagger','Reason',{custom_field_options:[{id:1,name:'Refund requested',value:'refund'},{id:2,name:'Shipment question',value:'shipping'}]})];
 const records=[{user:{id:1,role:'end-user',name:'Mara',email:'mara@example.test',created_at:dates.created_at}},...fields,form(401,'Order question',[301,302,303,304]),form(402,'Refund request',[301,304]),{ticket:{id:501,requester_id:1,subject:'Replacement parcel',status:'open',via:{channel:'email'},...dates,custom_fields:[{id:301,value:'ORDER-187'},{id:302,value:2},{id:303,value:false},{id:304,value:'shipping'}],comments:[{id:601,author_id:1,body:'The second parcel is damaged.',public:true,created_at:dates.created_at}]}}];
 const source=records.map(JSON.stringify).join('\n');
 await imported('zendesk',source,{before:h=>h.snapshot(),check:async({h,initial,review,plan,rows,omissions})=>{
  assert.equal(plan.counts.rejected,0,JSON.stringify(plan.decisions));
  const forms=(await h.call(dashboard+'/forms')).data,definitions=(await h.call(dashboard+'/ticket-fields')).data;
  assert.equal(forms.length,2);assert.ok(forms.every(form=>form.enabled===false));
  assert.equal(definitions.length,4);assert.equal(definitions.find(field=>field.name==='Order number').required,false,'import cannot make unrelated tickets unsolvable');
  assert.ok(omissions('ticket_field/301').includes('field_solve_requirement_requires_native_review'));
  const ticket=(await rows('SELECT id FROM conversations'))[0],native=(await h.call(`${dashboard}/conversations/${ticket.id}/ticket`)).data;
  assert.deepEqual(Object.fromEntries(definitions.map(field=>[field.name,native.fields[field.id]])),{'Order number':'ORDER-187',Items:2,'Replacement requested':false,Reason:'shipping'});
  for(const form of forms)assert.equal((await h.raw('/api/forms/p/'+form.id)).response.status,404,'import never publishes a request form');
  const beforeRepeat=await h.snapshot(),upload=await h.call(root+'?vendor=zendesk',{method:'POST',headers:{'X-Import-Filename':'repeat.jsonl'},body:'\n'+source});await h.drain();const repeated=(await h.call(root+'/'+upload.data.id)).data;
  assert.equal(repeated.plan.counts.rejected,0,JSON.stringify(repeated.plan.decisions));await h.call(root+'/'+repeated.id+'/apply',post({fingerprint:repeated.plan.fingerprint}));await h.drain();assertBusinessEquality(beforeRepeat,await h.snapshot());
  await h.call(root+'/'+review.id+'/undo',post({}));await h.drain();assertBusinessEquality(initial,await h.snapshot());
 }});
 await imported('zendesk',source,{check:async({h,review,rows})=>{
  const form=(await h.call(dashboard+'/forms')).data.find(form=>form.title==='Order question');
  await h.call(dashboard+'/forms/'+form.id,{...post({...form,enabled:true}),method:'PATCH'});
  const visible=(await h.call('/api/forms/p/'+form.id)).data;
  assert.deepEqual(visible.fields.filter(field=>!['subject','message'].includes(field.id)).map(field=>[field.label,field.required]),[['Order number',true],['Items',true],['Replacement requested',true],['Reason',true]]);
  assert.deepEqual(visible.fields.find(field=>field.label==='Reason').options,[{value:'refund',label:'Refund requested'},{value:'shipping',label:'Shipment question'}]);
  await h.call(root+'/'+review.id+'/undo',post({}));await h.drain();
  assert.equal((await h.call('/api/forms/p/'+form.id)).data.title,'Order question','undo preserves an explicitly published native form');
  assert.equal((await rows('SELECT count(*) n FROM ticket_fields'))[0].n,4,'undo preserves definitions referenced by that form');
 }});
 for(const changed of [form(403,'Conditional request',[301],{end_user_conditions:[{parent_field_id:301,value:'urgent'}]}),form(403,'Missing field',[999]),form(403,'Restricted request',[301],{restricted_brand_ids:[8],in_all_brands:false})])await imported('zendesk',[...fields,changed].map(JSON.stringify).join('\n'),{check:async({plan,rows})=>{
  assert.ok(plan.decisions.find(row=>row.kind==='ticket_form').rejection,'unsupported form is rejected whole');assert.equal((await rows('SELECT count(*) n FROM request_forms'))[0].n,0);
 }});
}
