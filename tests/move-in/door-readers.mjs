import {registerHooks} from 'node:module';
import {existsSync} from 'node:fs';
import assert from 'node:assert/strict';
import {phases} from '../journeys/kit/scenarios.mjs';
import {nativeHarness} from './harness.mjs';
import {zip} from './zip.mjs';
import {archive} from './archive-inputs.mjs';
import {documents} from './shape-inputs.mjs';
import {laterSource,person as emptyPerson,sourceName} from './empty-inputs.mjs';
import {records as envelopeRecords,positions} from './envelope-inputs.mjs';
import {nestedRecord,nestedCases} from './nested-inputs.mjs';
import {intercomRecords,zendeskRecords,collectionNames,collisionValues,recordPackages,ambiguousRecords} from './record-inputs.mjs';
registerHooks({resolve(specifier,context,next){if(specifier.startsWith('.')&&context.parentURL){const url=new URL(specifier+'.ts',context.parentURL);if(existsSync(url))return next(url.href,context)}return next(specifier,context)}});
// The keyed digests D1 stores for identity links; used only to look up actual stored rows.
const {identityDigest,sourceDigest}=await import('../../src/modules/move-in/identities.ts');
const test=phases(import.meta.url);
const root='/api/move-in/projects/p/imports',post=body=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
let unique=0;

// Every check below goes through the real upload route, its queue and its review.
function door(h){
 const send=(vendor,name,body)=>h.raw(`${root}?vendor=${vendor}`,{method:'POST',headers:{'X-Import-Filename':name,'X-Import-Schema':'2.16'},body});
 return {
  async refused(vendor,name,body,code,row,pointer,artifact=name){
   const result=await send(vendor,name,body);assert.equal(result.response.status,422,`${vendor}/${name}: ${JSON.stringify(result.data).slice(0,300)}`)
   if(code!==undefined)assert.deepEqual(result.data.diagnostic,{code,location:{artifact,row,pointer}},`${vendor}/${name}`)
   assert.equal(h.lastWrites,0,name);assert.equal(h.queued.length,0,name);return result.data.diagnostic
  },
  async review(vendor,name,body){
   // Trailing blank lines keep each upload a distinct artifact without moving any record.
   const bytes=typeof body==='string'?body+'\n'.repeat(++unique):body,result=await send(vendor,name,bytes)
   assert.equal(result.response.status,201,`${vendor}/${name}: ${JSON.stringify(result.data).slice(0,300)}`);await h.drain()
   const view=(await h.call(`${root}/${result.data.data.id}`)).data
   const stored=(await h.db.prepare('SELECT record_json FROM move_in_records WHERE run_id=? ORDER BY ordinal').bind(view.id).all()).results.map(row=>JSON.parse(row.record_json))
   const links=new Set((await h.db.prepare('SELECT digest FROM move_in_identity_links WHERE run_id=?').bind(view.id).all()).results.map(row=>row.digest))
   const complete=(await h.db.prepare('SELECT identity_complete FROM move_in_runs WHERE id=?').bind(view.id).first()).identity_complete===1
   return {view,plan:view.plan,stored,complete,has:(category,value)=>links.has(identityDigest('p',category,value)),hasSource:(vendor,id)=>links.has(sourceDigest('p',vendor,id)),links}
  },
  async apply(view){await h.call(`${root}/${view.id}/apply`,post({fingerprint:view.plan.fingerprint}));await h.drain();return (await h.call(`${root}/${view.id}`)).data},
 };
}
async function withDoor(body){const h=await nativeHarness();try{await body(door(h),h);assert.equal(h.outbound,0)}finally{await h.close()}}
const decision=(plan,kind)=>plan.decisions.find(row=>row.kind===kind);

import {step} from './steps.mjs';

test("refusals: refused uploads are located at their exact source place before any custody, queue, native write or outbound call",async()=>{
await step('size, depth, count, node, link and hash bounds refuse at their exact place; values at each bound are accepted with their aliases',()=>withDoor(async d=>{
 for(const format of ['jsonl','json','zip']){
  const cases=[['[{"type":"contact","id":"first","i\\u0064":"second"}]','duplicate_json_field'],['[{"type":"contact","id":"deep","unknown":'+'['.repeat(129)+'0'+']'.repeat(129)+'}]','source_structure_depth_limit'],[JSON.stringify([{type:'contact',id:'big',name:'x'.repeat(128*1024)}]),'record_size_limit'],['['+Array(5001).fill('{"type":"contact","id":"one"}').join(',')+']','export_record_limit']]
  for(const [array,code] of cases){const body=format==='jsonl'?array.slice(1,-1).replaceAll('},{','}\n{'):array,name=format==='jsonl'?'source.jsonl':'source.json',diagnostic=await d.refused('intercom',format==='zip'?'source.zip':name,format==='zip'?zip([{name:'nested/'+name,body}]):body);assert.equal(diagnostic.code,code);assert.equal(diagnostic.location.artifact,format==='zip'?'nested/'+name:name);assert.ok(diagnostic.location.row>=1)}
 }
 const wide=JSON.stringify({type:'macro',id:'wide',name:'R',body:'Hello',visible_to:'everyone',available_on:Array(4000).fill('inbox')});assert.equal((await d.refused('intercom','wide.jsonl',Array(51).fill(wide).join('\n'))).code,'upload_identity_node_limit')
 const person=id=>({type:'contact',id,email:id+'@example.test',external_id:id}),record=i=>({type:'conversation',id:String(i),contacts:{type:'contact.list',contacts:Array.from({length:100},(_,j)=>person(`${i}-${j}`))}})
 assert.equal((await d.refused('intercom','links.jsonl',Array.from({length:51},(_,i)=>JSON.stringify(record(i))).join('\n'))).code,'upload_identity_link_limit')
 const same={type:'conversation',id:'repeated',contacts:{type:'contact.list',contacts:Array(100).fill(person('same'))}};assert.equal((await d.refused('intercom','hashes.jsonl',Array(81).fill(JSON.stringify(same)).join('\n'))).code,'upload_identity_hash_limit')
 // Exactly at each bound: accepted, and the known source alias is recorded.
 const atLimit={type:'contact',id:'at-limit',email:'at-limit@example.test',created_at:1704067200},serialized=JSON.stringify(atLimit),exact=JSON.stringify({...atLimit,name:''}),sized=JSON.stringify({...atLimit,name:'x'.repeat(128*1024-Buffer.byteLength(exact))})
 for(const [name,body,complete] of [['bytes.jsonl',sized,true],['count.jsonl',Array(5000).fill(serialized).join('\n'),true],['depth.jsonl',serialized.slice(0,-1)+',"unknown":'+'['.repeat(127)+'0'+']'.repeat(127)+'}',false],['archive.zip',zip(Array.from({length:64},(_,i)=>({name:`${i}.jsonl`,body:serialized}))),true],['expanded.zip',zip([{name:'at-limit.json',body:serialized+' '.repeat(2*1024*1024-Buffer.byteLength(serialized))}]),true]]){
  const reviewed=await d.review('intercom',name,body);assert.ok(reviewed.hasSource('intercom','at-limit'),name);assert.equal(reviewed.complete,complete,name)
 }
 const user={user:{id:1,role:'end-user',name:'A',email:'a@example.test',created_at:'2024-01-01T00:00:00Z',tags:Array(4089).fill('x')}};assert.equal((await d.review('zendesk','nodes.jsonl',JSON.stringify(user))).complete,true)
 user.user.tags.push('x');await d.refused('zendesk','nodes.jsonl',JSON.stringify(user),'source_identity_node_limit',1,'/user/tags/4089')
 // Known aliases survive diagnostic truncation in either property order; free text is not an email detector.
 for(const vendor of ['intercom','zendesk']){
  const input=documents(vendor).person,payload=vendor==='zendesk'?input.user:input,fields=Object.fromEntries(Array.from({length:128},(_,i)=>[`unknown${i}`,null]));payload.email='ordinary@example.test';payload.external_id='ordinary-external'
  for(const record of [{...fields,...payload},{...payload,...fields}]){const reviewed=await d.review(vendor,'source.jsonl',JSON.stringify(vendor==='zendesk'?{user:record}:record));assert.equal(reviewed.complete,false);assert.ok(reviewed.hasSource(vendor,String(payload.id)));assert.ok(reviewed.has('email','ordinary@example.test'));assert.ok(reviewed.has('external','ordinary-external'))}
  const article=documents(vendor).article,body=vendor==='zendesk'?article.article:article;body.body='ordinary@example.test';body.translated_content=null;const text=await d.review(vendor,'text.jsonl',JSON.stringify(article));assert.equal(text.complete,true);assert.equal(text.links.size,0)
 }
}));
await step('empty-looking, malformed and late-failing uploads keep their precise first refusal; records after blank chunks keep identity, payload and location',()=>withDoor(async d=>{
 for(const vendor of ['zendesk','intercom']){
  for(const offset of [0,20,40]){const {body,record}=laterSource(vendor,{offset}),reviewed=await d.review(vendor,'later.zip',body),expected=vendor==='zendesk'?['user','83']:['contact','person-83'];assert.deepEqual(reviewed.plan.decisions.map(row=>[row.kind,row.sourceId,row.location]),[[...expected,{artifact:sourceName(vendor),row:2}]]);assert.deepEqual(reviewed.stored[0].payload,vendor==='zendesk'?record.user:record);assert.ok(reviewed.has('email','keira@example.test'));assert.equal(reviewed.complete,true)}
  const empty=Array.from({length:21},(_,i)=>({name:`empty-${i}/`}))
  for(const first of [[],[{name:sourceName(vendor),body:JSON.stringify(emptyPerson(vendor))}]]){
   await d.refused(vendor,'bad.zip',archive([...first,...empty,{name:'late/bad.jsonl',body:'\r\n\r\n{"type":'}]),'invalid_json',3,'/type','late/bad.jsonl')
   await d.refused(vendor,'bad.zip',archive([...first,...empty,{name:'broken/',compressed:Buffer.from([3])}]),'archive_integrity',1,'','broken/')
  }
 }
 for(const [vendor,name,body,code,pointer] of [['zendesk','array.ndjson','\n[]','record_must_be_object',''],['zendesk','envelope.ndjson','\n{"users":[]}','singular_wrapper_required','/users'],['intercom','object.json','\n{}','explicit_record_type_required',''],['intercom','collection.json','\n{"contacts":null}','collection_must_be_array','/contacts'],['intercom','unsupported.txt','\n ','unsupported_file_extension','']]){const diagnostic=await d.refused(vendor,name,body);assert.equal(diagnostic.code,code,name);assert.equal(diagnostic.location.pointer,pointer,name)}
 for(const [options,code] of [[{prefix:'unclaimed'},'archive_unclaimed_bytes'],[{comment:'metadata'},'archive_unsupported_metadata'],[{suffix:'unclaimed'},'archive_footer']])assert.equal((await d.refused('intercom','empty.zip',archive([],options))).code,code)
 const opaque=await d.review('intercom','opaque.json','{"type":"list","unknown":[]}');assert.equal(opaque.complete,false);assert.equal(opaque.plan.decisions[0].kind,'unsupported-field:unknown');assert.equal(opaque.links.size,0)
}));
await step('ZIP members in every storage form are read in bounded physical slices; unclaimed, overlapping and corrupted bytes, unsafe paths and expansion are refused',()=>withDoor(async d=>{
 const contact=envelopeRecords().contact
 for(const method of [0,8])for(const descriptor of [false,true,'unsigned']){
  const entries=Array.from({length:44},(_,i)=>i%3?{name:`empty-${i}/`,method,descriptor,flags:descriptor?8:0}:{name:`record-${i}.json`,body:JSON.stringify({...contact,id:`${method}-${descriptor}-${i}`}),method,descriptor,flags:descriptor?8:0})
  const reviewed=await d.review('intercom','valid.zip',archive(entries));assert.equal(reviewed.plan.counts.input,15);assert.equal(reviewed.complete,true)
  assert.deepEqual(reviewed.plan.decisions.map(row=>row.location.artifact),entries.filter(entry=>!entry.name.endsWith('/')).map(entry=>entry.name))
 }
 // CRC 0x08074b50 equals the optional descriptor signature; the member is still read as itself.
 for(const method of [0,8])for(const descriptor of [true,'unsigned']){const diagnostic=await d.refused('intercom','descriptor.zip',archive([{name:'source.json',body:Buffer.from([172,10,122,213]),method,flags:8,descriptor}]));assert.equal(diagnostic.location.artifact,'source.json');assert.doesNotMatch(diagnostic.code,/^archive_/)}
 const entry={name:'safe.json',body:JSON.stringify(contact)}
 for(const options of [{prefix:'private'},{gap:'private'},{comment:'private'}])assert.ok(['archive_unclaimed_bytes','archive_unsupported_metadata'].includes((await d.refused('intercom','opaque.zip',archive([entry],options))).code))
 for(const name of ['empty/','safe.json'])assert.ok(['archive_entry_overlap','archive_name_mismatch'].includes((await d.refused('intercom','overlap.zip',archive([{name:'first/',method:0},{name,method:0,central:header=>header.writeUInt32LE(0,42)}]))).code))
 assert.equal((await d.refused('intercom','bad.zip',new Uint8Array([80,75,3,4]))).code,'archive_footer')
 for(const name of ['../contacts.json','/contacts.json','C:/contacts.json','a\\b.json','a//b.json'])assert.equal((await d.refused('intercom','export.zip',zip([{name,body:'{}'}]))).code,'archive_unsafe_path',name)
 assert.equal((await d.refused('intercom','export.zip',zip([{name:'same.json',body:'{}'},{name:'same.json',body:'{}'}]))).code,'archive_duplicate_path')
 const good=zip([{name:'nested/contacts.jsonl',body:'{"type":"contact","id":"one"}\n'}]),corrupt=Buffer.from(good),central=corrupt.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));corrupt.writeUInt32LE(0,central+16);assert.equal((await d.refused('intercom','export.zip',corrupt)).code,'archive_integrity')
 assert.equal((await d.refused('intercom','export.zip',zip([{name:'large.json',body:' '.repeat(2*1024*1024+1)}]))).code,'archive_expansion_limit')
 const read=await d.review('intercom','export.zip',good);assert.equal(read.plan.decisions[0].location.artifact,'nested/contacts.jsonl')
}));
});

test("review: an accepted export is reviewed with each record's kind, ID, payload, exact location, duplicates, conflicts and reasons before anything is approved",async()=>{
await step('every supported envelope position keeps the record kind, ID, payload and exact location; foreign positions are counted warnings with incomplete custody',()=>withDoor(async d=>{
 for(const original of Object.values(envelopeRecords()))for(const [name,body,pointer] of positions(original)){
  const reviewed=await d.review('intercom',name,body),row=decision(reviewed.plan,original.type);assert.ok(row,name);assert.equal(row.sourceId,original.id);assert.deepEqual(row.location,{artifact:name,row:2,...(pointer?{pointer}:{})});assert.deepEqual(reviewed.stored.find(item=>item.kind===original.type).payload,original)
  assert.equal(reviewed.complete,!name.startsWith('foreign'),name);if(name.startsWith('foreign'))assert.ok(reviewed.plan.diagnostics.some(item=>item.code==='unsupported_source_field'&&item.location.pointer===pointer))
  if(original.type==='contact')assert.ok(reviewed.has('email','nadia@example.test'))
 }
 // Explicit kinds and discriminator orders share one reading across unknown collection keys and both JSON forms.
 for(const kind of ['contact','conversation','macro','article','user','lead','tag','tag-name','company','admin','unknown'])for(const discriminator of [{type:kind},{kind},{type:kind,kind}]){
  const payload={...(envelopeRecords()[kind]??{id:'opaque',email:'opaque@example.test'}),...discriminator};if(!Object.hasOwn(discriminator,'type'))delete payload.type
  const value=kind==='macro'?Object.fromEntries(Object.entries(payload).reverse()):payload,reviewed=await d.review('intercom','positions.json','\n'+JSON.stringify({type:'list',arbitrary:[value]})),stored=reviewed.stored.find(item=>item.sourceId===payload.id)
  assert.equal(stored.kind,kind);assert.equal(stored.location.pointer,'/arbitrary/0');assert.deepEqual(stored.payload,value);if(['contact','user','lead'].includes(kind))assert.ok(reviewed.has('email',payload.email),kind)
 }
 for(const key of ['contacts','data','arbitrary','a/b~c',''])for(const singular of [false,true])for(const name of ['positions.json','positions.jsonl']){
  if(singular&&['contacts','data'].includes(key))continue
  const pointer='/'+key.replace(/~/g,'~0').replace(/\//g,'~1')+(singular?'':'/0'),contact=envelopeRecords().contact,reviewed=await d.review('intercom',name,'\n'+JSON.stringify({type:'list',[key]:singular?contact:[contact]}))
  assert.equal(reviewed.stored[0].kind,'contact');assert.equal(reviewed.stored[0].location.pointer,pointer,`${key}/${singular}`);assert.ok(reviewed.has('email','nadia@example.test'))
 }
 const packaged=await d.review('intercom','multi.zip',archive(positions(envelopeRecords().contact).map(([name,body])=>({name:'nested/'+name,body}))));assert.equal(packaged.complete,false);assert.ok(packaged.has('external','customer-archive'))
 // Untyped unknown values stay reasoned omissions without guessed aliases; typed ambiguity refuses every parent.
 for(const value of [null,false,3,'arbitrary@example.test',{},[],{id:'untyped',email:'arbitrary@example.test'},[{type:'contact',id:'nested',email:'arbitrary@example.test'}]]){
  const reviewed=await d.review('intercom','opaque.json',JSON.stringify({type:'list',unknown:value}));assert.equal(reviewed.complete,false)
  if(Array.isArray(value)&&value.length){assert.equal(reviewed.stored[0].kind,'contact');assert.ok(reviewed.links.size)}else{assert.equal(reviewed.stored[0].kind,'unsupported-field:unknown');assert.equal(reviewed.links.size,0)}
 }
 for(const key of ['data','unknown'])for(const [record,code,suffix] of [[{type:null},'invalid_record_discriminator','/type'],[{type:'contact',kind:'macro'},'conflicting_record_discriminator','/kind'],[{type:'list',data:[envelopeRecords().contact]},'record_required_inside_collection','']])for(const [field,pointer] of [[{[key]:[record]},`/${key}/0`],...(key==='unknown'?[[{[key]:record},`/${key}`]]:[])]){const diagnostic=await d.refused('intercom','refused.json',JSON.stringify({type:'list',...field}));assert.equal(diagnostic.code,code);assert.equal(diagnostic.location.pointer,pointer+suffix)}
 await d.refused('intercom','opaque.json',JSON.stringify({type:'list',unknown:{wrapper:envelopeRecords().contact}}),'unsupported_nested_envelope',1,'/unknown')
 await d.refused('intercom','hidden.zip',archive([{name:'hidden/',body:'private bytes'},{name:'contact.json',body:JSON.stringify(envelopeRecords().contact)}]),'archive_directory_not_empty',1,'','hidden/')
}));
await step('untyped nested containers are refused at their exact place at every depth and packaging; identified records keep their payload boundary and only real aliases',()=>withDoor(async d=>{
 for(const kind of ['contact','conversation','macro','article','user','lead','tag','tag-name','company','admin','unknown'])for(const discriminator of [{type:kind},{kind},{type:kind,kind}]){
  const record={id:'nested-81',...discriminator,email:'imani@example.test'};for(const [name,body,row,pointer] of nestedCases(record))await d.refused('intercom',name,body,'unsupported_nested_envelope',row,pointer)
 }
 for(const depth of [1,2,7,31,120]){let wrapper=nestedRecord;for(let i=0;i<depth;i++)wrapper=i%2?[wrapper]:{'a/b~c':wrapper};await d.refused('intercom','depth.json',JSON.stringify({type:'list',unknown:wrapper}),'unsupported_nested_envelope',1,Array.isArray(wrapper)?'/unknown/0':'/unknown')}
 for(const [name,body,row,pointer] of nestedCases())await d.refused('intercom','multi.zip',archive([{name:'safe.json',body:JSON.stringify(nestedRecord)},{name:'inner/'+name,body}]),'unsupported_nested_envelope',row,pointer,'inner/'+name)
 await d.refused('intercom','mixed.jsonl',JSON.stringify(nestedRecord)+'\n\n'+JSON.stringify({type:'list',unknown:{wrapper:nestedRecord}}),'unsupported_nested_envelope',3,'/unknown')
 for(const kind of ['user','ticket','macro','article','organization','group','ticket_form','ticket_field','ticket_event','tag','unknown'])await d.refused('zendesk','wrapped.ndjson','\n'+JSON.stringify({box:{deeper:[{[kind]:{id:81,name:'Imani'}}]}}),'unsupported_wrapper_requires_record_id',2,'/box')
 for(const [payload,id] of [[{id:81,name:'Named tag'},'81'],[{name:'Named tag'},'Named tag']]){const reviewed=await d.review('zendesk','tag.ndjson',JSON.stringify({tag:payload}));assert.equal(reviewed.stored[0].kind,'tag');assert.equal(reviewed.stored[0].sourceId,id);assert.deepEqual(reviewed.stored[0].payload,payload);assert.equal(reviewed.complete,false)}
 await d.refused('zendesk','tag.ndjson',JSON.stringify({tag:{wrapper:{user:{id:81}}}}),'invalid_source_id',1,'/tag')
 for(const discriminator of [{type:'contact'},{kind:'contact'},{type:'contact',kind:'contact'}]){
  const record={...nestedRecord,...discriminator,details:{wrapper:{type:'article',id:'payload-only',body:'ordinary@example.test'}}};if(!Object.hasOwn(discriminator,'type'))delete record.type
  for(const [name,body,pointer] of [['root.json',JSON.stringify(record),''],['known.json',JSON.stringify({contacts:[record]}),'/contacts/0'],['unknown.json',JSON.stringify({type:'list',unknown:record}),'/unknown']]){
   const reviewed=await d.review('intercom',name,body);assert.equal(reviewed.stored.length,1);assert.equal(reviewed.stored[0].kind,'contact');assert.equal(reviewed.stored[0].sourceId,'nested-81');assert.deepEqual(reviewed.stored[0].payload,record);assert.deepEqual(reviewed.stored[0].location,{artifact:name,row:1,...(pointer?{pointer}:{})})
   assert.equal(reviewed.complete,false);assert.ok(reviewed.has('email','imani@example.test'));assert.ok(!reviewed.has('email','ordinary@example.test'))
  }
 }
 for(const value of [null,false,42,'ordinary@example.test',{},[],{id:'opaque',note:'ordinary@example.test'}]){const reviewed=await d.review('intercom','opaque.json',JSON.stringify({type:'list',unknown:value}));assert.equal(reviewed.stored[0].kind,'unsupported-field:unknown');assert.deepEqual(reviewed.stored[0].payload,value);assert.equal(reviewed.links.size,0)}
 const leaf={values:Array(4094).fill(0)};assert.equal((await d.review('intercom','bounded.json',JSON.stringify({type:'list',unknown:leaf}))).complete,false)
 await d.refused('intercom','over.json',JSON.stringify({type:'list',unknown:{values:Array(4095).fill(0)}}),'opaque_structure_node_limit',1,'/unknown')
 const allowed=await d.review('intercom','allowed.json',JSON.stringify({type:'list',unknown:Array(48).fill(leaf),contacts:[nestedRecord]}));assert.equal(allowed.complete,false);assert.ok(allowed.has('email','imani@example.test'))
 await d.refused('intercom','excess.json',JSON.stringify({type:'list',unknown:Array(49).fill(leaf)}),'upload_opaque_structure_node_limit',1,'/unknown/48')
 const metadata=await d.review('intercom','metadata.json',JSON.stringify({type:'list',pages:{next:{email:'ordinary@example.test'}},contacts:[nestedRecord]}));assert.deepEqual(metadata.stored.map(row=>row.kind),['unsupported-field:pages','contact']);assert.equal(metadata.complete,false);assert.ok(!metadata.has('email','ordinary@example.test'))
}));
await step('record discrimination keeps every typed payload, ID, location and alias across collection-named fields, orders and packagings; ambiguous or malformed discriminators are refused',()=>withDoor(async d=>{
 const expected={contact:[['source:intercom','person-31'],['email','person31@example.test'],['external','external-31']],conversation:[['source:intercom','person-31'],['email','participant@example.test'],['external','participant-external'],['source:intercom','staff-34'],['email','staff34@example.test'],['external','staff-external'],['source:intercom','staff-36'],['email','staff36@example.test'],['external','note-external']],macro:[],article:[]}
 const aliases=(reviewed,kind)=>{for(const [category,value] of expected[kind])assert.ok(reviewed.has(category,value),`${kind} ${category} ${value}`)}
 for(const kind of ['contact','conversation','macro','article'])for(const key of collectionNames)for(const [index,value] of collisionValues.entries())for(const order of ['before','after']){
  if(index%2!==(order==='before'?0:1)&&key!=='data')continue
  const original=intercomRecords()[kind],record=order==='before'?{[key]:value,...original}:{...original,[key]:value},[name,body,pointer]=recordPackages(record)[(index+collectionNames.indexOf(key))%recordPackages(record).length],reviewed=await d.review('intercom',name,body),stored=reviewed.stored.find(row=>row.sourceId===original.id)
  assert.equal(stored?.kind,kind,`${kind}/${key}/${order}/${name}`);assert.deepEqual(stored.payload,record);assert.deepEqual(stored.location,{artifact:name,row:2,...(pointer?{pointer}:{})})
  if(!(kind==='conversation'&&key==='contacts'&&order==='after'))aliases(reviewed,kind);else for(const staff of ['staff-34','staff-36'])assert.ok(reviewed.hasSource('intercom',staff))
 }
 for(const kind of ['contact','conversation','macro','article','user','lead','tag','tag-name','company','admin','unknown'])for(const field of ['type','kind','both'])for(const order of ['before','after']){
  const payload={id:'explicit',email:'explicit@example.test'},discriminator=field==='both'?{type:kind,kind}:{[field]:kind},record=order==='before'?{data:[],...payload,...discriminator}:{...payload,...discriminator,data:[]},[name,body]=recordPackages(record)[0],reviewed=await d.review('intercom',name,body)
  assert.equal(reviewed.stored.find(row=>row.sourceId==='explicit')?.kind,kind);if(['contact','user','lead'].includes(kind))assert.ok(reviewed.has('email','explicit@example.test'))
 }
 for(const [input,code,pointer] of ambiguousRecords())for(const record of [input,Object.fromEntries(Object.entries(input).reverse())])for(const [name,body,prefix] of recordPackages(record).slice(0,4))await d.refused('intercom',name,body,code,2,prefix+pointer)
 for(const value of [null,false,0,[],{},''])for(const field of ['type','kind'])assert.equal((await d.refused('intercom','bad.json',JSON.stringify({...intercomRecords().contact,[field]:value}))).location.pointer,'/'+field)
 for(const type of ['list','contact.list','conversation.list','macro.list'])for(const key of collectionNames.slice(0,5)){const diagnostic=await d.refused('intercom','bad.json',JSON.stringify({type,[key]:null}));assert.equal(diagnostic.code,'collection_must_be_array');assert.equal(diagnostic.location.pointer,'/'+key)}
 for(const body of ['\n {"unknown":null}','\n {"id":"untyped","contacts":[]}'])await d.refused('intercom','bad.json',body,'explicit_record_type_required',2,'')
 for(const body of [JSON.stringify([{type:'list',data:[intercomRecords().contact]}]),JSON.stringify({type:'list',data:[{type:'list',data:[intercomRecords().contact]}]})])assert.equal((await d.refused('intercom','nested.json',body)).code,'record_required_inside_collection')
 // True envelopes in both JSON forms keep the record, its pointer and complete custody; unknown siblings are counted warnings.
 const contact=intercomRecords().contact
 for(const discriminator of [{},{type:'list'},{kind:'list'},{type:'list',kind:'list'},{type:'contact.list'}])for(const key of ['contacts','conversations','data','articles','macros'])for(const extension of ['json','jsonl']){
  if((Object.keys(discriminator).length+key.length+extension.length)%2)continue
  const reviewed=await d.review('intercom','envelope.'+extension,'\n'+JSON.stringify({...discriminator,[key]:[contact],pages:null,total_count:1}));assert.equal(reviewed.stored[0].kind,'contact');assert.equal(reviewed.stored[0].location.pointer,`/${key}/0`);assert.equal(reviewed.complete,true);aliases(reviewed,'contact')
 }
 for(const siblings of [{companies:[contact]},{unknown:contact},{companies:[contact],unknown_metadata:'ordinary text'}]){const reviewed=await d.review('intercom','unknown.json',JSON.stringify({type:'list',...siblings}));assert.deepEqual(reviewed.stored.map(row=>row.kind),Object.keys(siblings).map(key=>key==='unknown_metadata'?'unsupported-field:unknown_metadata':'contact'));assert.ok(reviewed.plan.diagnostics.some(row=>row.code==='unsupported_source_field'));assert.equal(reviewed.complete,false);aliases(reviewed,'contact')}
 // The last admissible source position keeps its aliases inside a ZIP; one more is refused at that member.
 const prefix=Array(4999).fill(JSON.stringify(contact)).join('\n')
 for(const [kind,record] of Object.entries(intercomRecords())){const [name,body]=recordPackages(record)[0],reviewed=await d.review('intercom','boundary.zip',zip([{name:'first.jsonl',body:prefix},{name:`last-${kind}/`+name,body}]));assert.equal(reviewed.complete,true,kind);aliases(reviewed,'contact');aliases(reviewed,kind)}
 for(const [name,body,pointer,row] of [['last.json',JSON.stringify([contact,contact]),'/1',1],['last.jsonl',[contact,contact].map(JSON.stringify).join('\n'),'',2]])await d.refused('intercom','over.zip',zip([{name:'first.jsonl',body:prefix},{name,body}]),'export_record_limit',row,pointer,name)
}));
await step('Zendesk singular wrappers keep typed payloads for every kind and form; plural, mixed or untyped wrappers are refused before custody',()=>withDoor(async d=>{
 for(const [kind,record] of Object.entries(zendeskRecords())){
  for(const extension of ['ndjson','jsonl','json']){const name='source.'+extension,reviewed=await d.review('zendesk',name,'\n'+JSON.stringify(record));assert.equal(reviewed.stored[0].kind,kind);assert.deepEqual(reviewed.stored[0].payload,record[kind]);assert.deepEqual(reviewed.stored[0].location,{artifact:name,row:2});assert.equal(reviewed.complete,true);if(kind==='user')assert.ok(reviewed.has('email','person31@example.test'))}
  for(const name of collectionNames)for(const order of ['before','after']){const value=collisionValues[(collectionNames.indexOf(name)+(order==='after'?1:0))%collisionValues.length],payload=order==='before'?{[name]:value,...record[kind]}:{...record[kind],[name]:value},reviewed=await d.review('zendesk','source.ndjson','\n'+JSON.stringify({[kind]:payload}));assert.equal(reviewed.stored[0].kind,kind);assert.deepEqual(reviewed.stored[0].payload,payload)}
  for(const key of ['type','kind'])for(const value of [null,[],{},0,'different-kind']){const reviewed=await d.review('zendesk','payload.ndjson','\n'+JSON.stringify({[kind]:{...record[kind],[key]:value}}));assert.equal(reviewed.stored[0].kind,kind);assert.deepEqual(reviewed.stored[0].payload[key],value);assert.equal(reviewed.complete,kind==='ticket'&&key==='type'&&value===null);if(kind==='user')assert.ok(reviewed.has('email','person31@example.test'));if(kind==='ticket')assert.ok(reviewed.hasSource('zendesk','31'))}
 }
 for(const kind of ['organization','group','ticket_form','ticket_field','ticket_event','tag','unknown']){const reviewed=await d.review('zendesk','source.ndjson',JSON.stringify({[kind]:{id:41,name:'Retained'}}));assert.equal(reviewed.stored[0].kind,kind);assert.equal(reviewed.complete,false)}
 for(const record of [{user:zendeskRecords().user.user,ticket:zendeskRecords().ticket.ticket},{users:[zendeskRecords().user.user]},{user:null},[zendeskRecords().user],{User:zendeskRecords().user.user}]){const diagnostic=await d.refused('zendesk','bad.ndjson','\n'+JSON.stringify(record));assert.ok(['singular_wrapper_required','record_must_be_object'].includes(diagnostic.code));assert.equal(diagnostic.location.row,2)}
 for(const type of ['problem','incident','question','task',null]){const records=zendeskRecords(),ticket={ticket:{...records.ticket.ticket,type}},reviewed=await d.review('zendesk','typed.ndjson',[records.user,ticket].map(JSON.stringify).join('\n'));assert.equal(reviewed.complete,true);assert.ok(reviewed.hasSource('zendesk','31'));assert.equal(reviewed.plan.counts.rejected,0);assert.equal(reviewed.plan.counts.unique,3)}
}));
});
